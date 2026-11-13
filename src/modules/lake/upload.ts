import { copyFile, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { ingestRun, type IngestReject } from "@/db/schema";
import { runIngest, type RunIngestResult } from "@/modules/ingest/run-ingest";
import { DuckDbFileLake } from "./duckdb-file-lake";
import { FileSourceAdapter } from "./file-source-adapter";
import {
  getBuiltinProfile,
  validateAgainstSchema,
  type ProfileIssue,
  type SourceProfile,
} from "./profiles";
import type { LakeAdapter, LakeColumn, LakeRow } from "./types";
import {
  parseCustomProfile,
  resolveUpload,
  saveProfile,
  UploadError,
  type StoredUpload,
  type UploadStore,
} from "./upload-store";
import { PREVIEW_ROWS } from "./upload-shared";

// One import point for everything about uploads (the store has no DuckDB).
export {
  listProfiles,
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
  type UploadErrorCode,
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

/** Lake table the uploaded file is exposed as, whatever the profile calls it. */
const UPLOAD_TABLE = "upload";

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
