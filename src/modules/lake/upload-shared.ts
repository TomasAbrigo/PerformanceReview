import type { IngestCounts, IngestReject } from "@/db/schema";
import type { ProfileIssue } from "./profiles";
import type { LakeColumn, LakeRow } from "./types";

/**
 * What the upload screen and its server actions share. No server-only imports
 * here (no DuckDB, no fs): client components can import this module.
 */

export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
/** Accepted file types. */
export const UPLOAD_EXTENSIONS = [".csv", ".xlsx", ".parquet", ".ndjson"];

/** Rows shown in the preview. */
export const PREVIEW_ROWS = 20;

/** Custom profiles are stored as `<name>.json`: names must be safe file names. */
export const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type UploadErrorCode =
  | "no_file"
  | "empty_file"
  | "file_too_large"
  | "unsupported_type"
  | "unknown_upload"
  | "unreadable_file"
  /** The file lacks columns the profile needs, or their type drifted. */
  | "invalid_profile"
  /** The profile itself is malformed (name, keys...). */
  | "invalid_profile_definition"
  | "profile_exists";

/** Why an upload action failed. Codes map to UI messages; `message` is for logs. */
export type UploadFailure = {
  ok: false;
  code: UploadErrorCode | "unknown";
  message: string;
  issues: ProfileIssue[];
};

/** Result of storing and looking inside an uploaded file. */
export type InspectResult =
  | {
      ok: true;
      /** Pass back to the import action. */
      uploadId: string;
      fileName: string;
      size: number;
      /** The same content was uploaded before (stored once). */
      existed: boolean;
      columns: LakeColumn[];
      rows: LakeRow[];
    }
  | UploadFailure;

/** Result of landing the file's rows. */
export type ImportResult =
  | {
      ok: true;
      runId: string;
      counts: IngestCounts;
      /** The first rejected rows; all of them are on the run. */
      rejects: IngestReject[];
    }
  | UploadFailure;
