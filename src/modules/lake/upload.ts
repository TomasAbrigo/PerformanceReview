import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { ingestRun, type IngestReject } from "@/db/schema";
import { runIngest, type RunIngestResult } from "@/modules/ingest/run-ingest";
import { DuckDbFileLake } from "./duckdb-file-lake";
import { FileSourceAdapter } from "./file-source-adapter";
import {
  builtinProfiles,
  getBuiltinProfile,
  sourceProfileSchema,
  validateAgainstSchema,
  type ProfileIssue,
  type SourceProfile,
} from "./profiles";
import type { LakeAdapter, LakeColumn, LakeRow } from "./types";
import {
  PREVIEW_ROWS,
  PROFILE_NAME,
  UPLOAD_EXTENSIONS,
  UPLOAD_MAX_BYTES,
  type UploadErrorCode,
} from "./upload-shared";

export {
  PREVIEW_ROWS,
  UPLOAD_EXTENSIONS,
  UPLOAD_MAX_BYTES,
  type UploadErrorCode,
};

/**
 * Uploading a file to import: store it (content-addressed), look inside it,
 * pick or define a source profile, and land its rows in raw_record through
 * `FileSourceAdapter`. Server only. The heavy parts (reading with DuckDB,
 * ingesting) are meant to run in the upload worker process
 * (`scripts/ingest-upload.ts`), never inside a request handler.
 */

/** Rejects kept in the result of an import (all of them stay in ingest_run). */
const RESULT_REJECTS = 20;

/** Lake table the uploaded file is exposed as, whatever the profile calls it. */
const UPLOAD_TABLE = "upload";

/** A failure the user can act on; `code` maps to a UI message. */
export class UploadError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    message: string,
    /** For `invalid_profile`: what is wrong, column by column. */
    readonly issues: ProfileIssue[] = [],
  ) {
    super(message);
    this.name = "UploadError";
  }
}

/** Where uploads and custom profiles live (defaults: `var/` in the project). */
export type UploadStore = {
  uploadsDir?: string;
  profilesDir?: string;
  /** Size limit in bytes, default {@link UPLOAD_MAX_BYTES}. */
  maxBytes?: number;
};

const uploadsDirOf = (store: UploadStore) =>
  store.uploadsDir ?? process.env.UPLOADS_DIR ?? resolve("var/uploads");
const profilesDirOf = (store: UploadStore) =>
  store.profilesDir ?? process.env.PROFILES_DIR ?? resolve("var/profiles");

export type StoredUpload = {
  /** `<sha256><ext>`: the file name in the uploads folder, and the id the UI keeps. */
  id: string;
  sha256: string;
  ext: string;
  size: number;
  path: string;
  /** Already stored (same content uploaded before). */
  existed: boolean;
};

const UPLOAD_ID = /^([0-9a-f]{64})(\.[a-z]+)$/;

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
}

/**
 * Store an uploaded file as `<sha256>.<ext>`: the same content is stored once
 * whatever it was called. Checks type and size before writing anything.
 */
export async function storeUpload(
  file: { name: string; bytes: Uint8Array },
  store: UploadStore = {},
): Promise<StoredUpload> {
  const ext = extname(file.name).toLowerCase();
  if (!UPLOAD_EXTENSIONS.includes(ext)) {
    throw new UploadError(
      "unsupported_type",
      `Unsupported file type "${ext || file.name}": use ${UPLOAD_EXTENSIONS.join(", ")}`,
    );
  }
  if (file.bytes.length === 0) {
    throw new UploadError("empty_file", "The file is empty");
  }
  const maxBytes = store.maxBytes ?? UPLOAD_MAX_BYTES;
  if (file.bytes.length > maxBytes) {
    throw new UploadError(
      "file_too_large",
      `The file is ${file.bytes.length} bytes; the limit is ${maxBytes}`,
    );
  }

  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const id = `${sha256}${ext}`;
  const dir = uploadsDirOf(store);
  const path = join(dir, id);
  const stored = {
    id,
    sha256,
    ext,
    size: file.bytes.length,
    path,
  };
  if (await exists(path)) return { ...stored, existed: true };

  await mkdir(dir, { recursive: true });
  // Write aside and rename, so a reader never sees a half-written upload.
  const partial = `${path}.${process.pid}.partial`;
  await writeFile(partial, file.bytes);
  await rename(partial, path);
  return { ...stored, existed: false };
}

/** The stored upload an id refers to. Ids that are not ours never touch the disk. */
export async function resolveUpload(
  id: string,
  store: UploadStore = {},
): Promise<StoredUpload> {
  const match = UPLOAD_ID.exec(id);
  if (!match || !UPLOAD_EXTENSIONS.includes(match[2])) {
    throw new UploadError("unknown_upload", "Unknown upload");
  }
  const path = join(uploadsDirOf(store), id);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) {
    throw new UploadError("unknown_upload", "Unknown upload");
  }
  return {
    id,
    sha256: match[1],
    ext: match[2],
    size: info.size,
    path,
    existed: true,
  };
}

/**
 * Open a lake over a temporary folder where the upload shows up as
 * `upload.<ext>` (a symlink, so nothing is copied), and clean up afterwards.
 */
async function withUploadLake<T>(
  upload: StoredUpload,
  fn: (lake: LakeAdapter, table: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "upload-lake-"));
  try {
    const link = join(dir, `${UPLOAD_TABLE}${upload.ext}`);
    await symlink(upload.path, link).catch(() => copyFile(upload.path, link));
    const lake = await readable(() => DuckDbFileLake.open(dir));
    try {
      return await fn(lake, UPLOAD_TABLE);
    } finally {
      await lake.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** DuckDB failures on a bad file become an error the user can read. */
async function readable<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError(
      "unreadable_file",
      `The file could not be read: ${(error as Error).message}`,
    );
  }
}

export type UploadInspection = {
  columns: LakeColumn[];
  /** The first rows (see {@link PREVIEW_ROWS}), ordered by the first column. */
  rows: LakeRow[];
};

/** What is inside an upload: detected columns (with types) and a few rows. */
export async function inspectUpload(
  id: string,
  store: UploadStore = {},
  sampleSize = PREVIEW_ROWS,
): Promise<UploadInspection> {
  const upload = await resolveUpload(id, store);
  return readable(() =>
    withUploadLake(upload, async (lake, table) => {
      const columns = await lake.describeTable(table);
      if (columns.length === 0) {
        throw new UploadError("unreadable_file", "The file has no columns");
      }
      const rows: LakeRow[] = [];
      // The lake pages by key; any column will do for a look at the file.
      for await (const batch of lake.readBatches(table, {
        keyColumns: [columns[0].name],
        batchSize: sampleSize,
      })) {
        rows.push(...batch.rows);
        break;
      }
      return { columns, rows };
    }),
  );
}

// --- Profiles --------------------------------------------------------------

/** Parse a profile definition coming from the UI. */
function parseCustomProfile(input: unknown): SourceProfile {
  const parsed = sourceProfileSchema.safeParse(input);
  if (!parsed.success) {
    throw new UploadError(
      "invalid_profile_definition",
      `Invalid profile: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "profile"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const profile = parsed.data;
  if (!PROFILE_NAME.test(profile.name)) {
    throw new UploadError(
      "invalid_profile_definition",
      `Invalid profile name "${profile.name}": use lowercase letters, digits, "-" and "_" (up to 64)`,
    );
  }
  if (getBuiltinProfile(profile.name)) {
    throw new UploadError(
      "profile_exists",
      `"${profile.name}" is a built-in profile: choose another name`,
    );
  }
  return profile;
}

/** Save a custom profile (replacing one with the same name) under `var/profiles/`. */
export async function saveProfile(
  input: SourceProfile,
  store: UploadStore = {},
): Promise<SourceProfile> {
  const profile = parseCustomProfile(input);
  const dir = profilesDirOf(store);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${profile.name}.json`),
    `${JSON.stringify(profile, null, 2)}\n`,
  );
  return profile;
}

/** Built-in profiles followed by the custom ones saved so far. */
export async function listProfiles(
  store: UploadStore = {},
): Promise<SourceProfile[]> {
  const custom: SourceProfile[] = [];
  const files = await readdir(profilesDirOf(store)).catch(() => []);
  for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
    try {
      const raw: unknown = JSON.parse(
        await readFile(join(profilesDirOf(store), file), "utf8"),
      );
      // The file name is the profile name, as saveProfile wrote it.
      const profile = parseCustomProfile(raw);
      if (`${profile.name}.json` === file) custom.push(profile);
    } catch {
      // Not a profile (hand-edited, half-written): skip it.
    }
  }
  return [...builtinProfiles, ...custom];
}

// --- Import ----------------------------------------------------------------

export type ImportUploadInput = {
  uploadId: string;
  /** Name the file had when uploaded; only recorded on the run. */
  fileName: string;
  /** A built-in profile (by name) or a custom definition (saved on success). */
  profile: SourceProfile;
  db: DbOrTx;
  store?: UploadStore;
};

export type ImportUploadResult = RunIngestResult & {
  /** The first rejected rows; all of them are on the run. */
  rejects: IngestReject[];
};

function mismatchMessage(profile: SourceProfile, issues: ProfileIssue[]) {
  return `The file does not match profile "${profile.name}": ${issues
    .map((issue) => issue.message)
    .join("; ")}`;
}

/**
 * Land an uploaded file in raw_record with a source profile (landing only:
 * the domain mapping of its entity is a later step). The file is checked
 * against the profile first: if it lacks a column the profile needs, nothing
 * is written. Importing the same content again creates no new raw_records.
 */
export async function importUpload({
  uploadId,
  fileName,
  profile: requested,
  db,
  store = {},
}: ImportUploadInput): Promise<ImportUploadResult> {
  const upload = await resolveUpload(uploadId, store);
  const builtin = getBuiltinProfile(requested.name);
  const profile = builtin ?? parseCustomProfile(requested);

  const result = await withUploadLake(upload, async (lake, table) => {
    const columns = await readable(() => lake.describeTable(table));
    const issues = validateAgainstSchema(profile, columns);
    if (issues.length > 0) {
      throw new UploadError(
        "invalid_profile",
        mismatchMessage(profile, issues),
        issues,
      );
    }
    if (!builtin) await saveProfile(profile, store);
    return runIngest({
      adapter: new FileSourceAdapter(profile, lake, table),
      entity: profile.entity,
      landing: true,
      db,
      params: {
        fileName,
        profile: profile.name,
        size: upload.size,
        sha256: upload.sha256,
      },
    });
  });

  const [run] = await db
    .select({ rejects: ingestRun.rejects })
    .from(ingestRun)
    .where(eq(ingestRun.id, result.runId));
  return { ...result, rejects: (run?.rejects ?? []).slice(0, RESULT_REJECTS) };
}
