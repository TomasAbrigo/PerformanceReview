import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { ingestRun, type SourceSystem } from "@/db/schema";
import { runIngest } from "@/modules/ingest/run-ingest";
import { DuckDbFileLake } from "./duckdb-file-lake";
import { builtinSourceSystem, FileSourceAdapter } from "./file-source-adapter";
import {
  getBuiltinProfile,
  validateAgainstSchema,
  type SourceProfile,
} from "./profiles";
import type { LakeAdapter, LakeRow } from "./types";
import {
  loadSavedProfile,
  parseCustomProfile,
  profileExists,
  resolveUpload,
  saveProfile,
  UploadError,
  type StoredUpload,
  type UploadStore,
} from "./upload-store";
import {
  isHistoryProfile,
  isOrgAttributesProfile,
  PREVIEW_ROWS,
  type ImportUploadResult,
  type ProfileChoice,
  type UploadInspection,
} from "./upload-shared";

// One import point for everything about uploads (the store has no DuckDB).
export { markUploadRunsFailed } from "./upload-runs";
export {
  listProfiles,
  loadSavedProfile,
  profileExists,
  resolveUpload,
  saveProfile,
  storeUpload,
  UploadError,
  type StoredUpload,
  type UploadStore,
} from "./upload-store";
export {
  PREVIEW_ROWS,
  UPLOAD_EXTENSIONS,
  UPLOAD_MAX_BYTES,
  type ImportUploadResult,
  type ProfileChoice,
  type UploadErrorCode,
  type UploadInspection,
} from "./upload-shared";

/**
 * Uploading a file to import: store it (content-addressed), look inside it,
 * pick or define a source profile, and land its rows in raw_record through
 * `FileSourceAdapter`. Server only. The heavy parts (reading with DuckDB,
 * ingesting) are meant to run in the upload worker process
 * (`scripts/ingest-upload.ts`), never inside a request handler.
 */

/** Rejects kept in the result of an import (all of them stay in ingest_run). */
const RESULT_REJECTS = 20;

/**
 * Bamboo's report exports (built-in `bamboo-*` profiles and those built on
 * a real-report base) are read as text: dates are parsed by the importer.
 */
const readsAsText = (profile: SourceProfile) =>
  profile.name.startsWith("bamboo-") || profile.format !== undefined;

/** Lake table the uploaded file is exposed as, whatever the profile calls it. */
const UPLOAD_TABLE = "upload";

/**
 * Open a lake over a temporary folder where the upload shows up as
 * `upload.<ext>` (a symlink, so nothing is copied), and clean up afterwards.
 */
async function withUploadLake<T>(
  upload: StoredUpload,
  fn: (lake: LakeAdapter, table: string) => Promise<T>,
  options: { allText?: boolean } = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "upload-lake-"));
  try {
    const link = join(dir, `${UPLOAD_TABLE}${upload.ext}`);
    // Absolute: a relative target would be read from the link's own folder.
    const target = resolve(upload.path);
    await symlink(target, link).catch(() => copyFile(target, link));
    const lake = await readable(() => DuckDbFileLake.open(dir, options));
    try {
      return await fn(lake, UPLOAD_TABLE);
    } finally {
      await lake.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The ingest of an import: validates the file against the profile, then runs
 * the profile's pipeline with the params reprocess and resume read back.
 */
async function ingestUploaded({
  upload,
  fileName,
  profile,
  source,
  db,
  signal,
  landing = false,
  partial = false,
}: {
  upload: StoredUpload;
  fileName: string;
  profile: SourceProfile;
  source: SourceSystem;
  db: DbOrTx;
  signal?: AbortSignal;
  landing?: boolean;
  /** Org attributes file: it lists only some rows (stored on the run). */
  partial?: boolean;
}) {
  return withUploadLake(
    upload,
    async (lake, table) => {
      const columns = await readable(() => lake.describeTable(table));
      // The messages name the file the user uploaded, not the profile's table.
      const issues = validateAgainstSchema(profile, columns, fileName);
      if (issues.length > 0) {
        throw new UploadError(
          "invalid_profile",
          `The file does not match profile "${profile.name}": ${issues
            .map((issue) => issue.message)
            .join("; ")}`,
          issues,
        );
      }
      return runIngest({
        adapter: new FileSourceAdapter(profile, lake, table, {
          source,
          fileKey: upload.sha256,
        }),
        entity: profile.entity,
        landing,
        syncState: false,
        ...(profile.questions ? { questions: profile.questions } : {}),
        db,
        extract: { signal },
        params: {
          fileName,
          profile: profile.name,
          size: upload.size,
          sha256: upload.sha256,
          ...(partial ? { partial: true } : {}),
        },
      });
    },
    { allText: readsAsText(profile) },
  );
}

/**
 * Imports a file from disk in-process (seed, tests) exactly as an upload of
 * it would be: same validation, same pipeline, same run params. A built-in
 * history profile goes to the domain; `source` defaults to the profile's.
 */
export async function importReportFile(
  db: DbOrTx,
  {
    path,
    profile,
    source,
  }: { path: string; profile: string | SourceProfile; source?: SourceSystem },
) {
  const resolved =
    typeof profile === "string" ? getBuiltinProfile(profile) : profile;
  if (!resolved) throw new Error(`Unknown built-in profile ${String(profile)}`);
  const content = await readFile(path);
  const sha256 = createHash("sha256").update(content).digest("hex");
  const ext = extname(path);
  return ingestUploaded({
    upload: {
      id: `${sha256}${ext}`,
      sha256,
      ext,
      size: content.length,
      path,
      existed: true,
    },
    fileName: basename(path),
    profile: resolved,
    source: source ?? builtinSourceSystem(resolved),
    db,
    landing: !isHistoryProfile(resolved) && !isOrgAttributesProfile(resolved),
  });
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

// --- Import ----------------------------------------------------------------

export type ImportUploadInput = {
  uploadId: string;
  /** Name the file had when uploaded: recorded on the run, worded in messages. */
  fileName: string;
  profile: ProfileChoice;
  db: DbOrTx;
  store?: UploadStore;
  /** Aborted when the worker is told to stop: the run ends in error. */
  signal?: AbortSignal;
  /** History profiles (see isHistoryProfile): only land the rows. */
  landing?: boolean;
  /**
   * Org attributes file (see isOrgAttributesProfile): it lists only some of
   * the rows, so what it does not mention is not dropped.
   */
  partial?: boolean;
};

/** The profile a choice means, and whether it is new (saved after the import). */
async function chosenProfile(
  choice: ProfileChoice,
  store: UploadStore,
): Promise<{ profile: SourceProfile; source: SourceSystem; isNew: boolean }> {
  if ("builtin" in choice) {
    const profile = getBuiltinProfile(choice.builtin);
    if (!profile) {
      throw new UploadError(
        "unknown_profile",
        `Unknown built-in profile "${choice.builtin}"`,
      );
    }
    return { profile, source: builtinSourceSystem(profile), isNew: false };
  }
  if ("saved" in choice) {
    const profile = await loadSavedProfile(choice.saved, store);
    if (!profile) {
      throw new UploadError(
        "unknown_profile",
        `No saved profile named "${choice.saved}"`,
      );
    }
    return { profile, source: "lake", isNew: false };
  }
  // Built-in names are refused here (profile_exists), never looked up.
  const profile = parseCustomProfile(choice.custom);
  if (!choice.replace && (await profileExists(profile.name, store))) {
    throw new UploadError(
      "profile_exists",
      `A saved profile named "${profile.name}" already exists`,
    );
  }
  return { profile, source: "lake", isNew: true };
}

/**
 * Import an uploaded file with a source profile. Bamboo's Employee
 * Performance and Feedback Status reports (built-in profiles) are mapped to
 * historical review cycles (src/modules/import-history) unless `landing`;
 * every other file is landed in raw_record only (its domain mapping is a
 * later step). The file is checked
 * against the profile first: if it lacks a column the profile needs, nothing
 * is written. A new custom profile is saved only after the import succeeded.
 * Importing the same content again creates no new raw_records.
 */
export async function importUpload({
  uploadId,
  fileName,
  profile: choice,
  db,
  store = {},
  signal,
  landing = false,
  partial = false,
}: ImportUploadInput): Promise<ImportUploadResult> {
  const { profile, source, isNew } = await chosenProfile(choice, store);
  // Bamboo's performance reports become historical cycles (import-history);
  // anything else, or when asked, is only landed in raw_record.
  const attributes = isOrgAttributesProfile(profile);
  const domain = isHistoryProfile(profile) && !landing;
  const upload = await resolveUpload(uploadId, store);

  const result = await ingestUploaded({
    upload,
    fileName,
    profile,
    source,
    db,
    signal,
    landing: !domain && !attributes,
    partial: attributes && partial,
  });

  // Only now: a failed import leaves no profile behind.
  if (isNew) await saveProfile(profile, store, { replace: true });

  const [run] = await db
    .select({ rejects: ingestRun.rejects })
    .from(ingestRun)
    .where(eq(ingestRun.id, result.runId));
  return {
    ...result,
    rejects: (run?.rejects ?? []).slice(0, RESULT_REJECTS),
    mode: domain ? "domain" : attributes ? "attributes" : "landing",
  };
}
