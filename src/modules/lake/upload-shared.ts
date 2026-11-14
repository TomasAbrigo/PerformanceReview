import { z } from "zod";
import type { IngestCounts, IngestReject } from "@/db/schema";
import {
  sourceProfileSchema,
  type ProfileIssue,
  type SourceProfile,
} from "./profiles";
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
  /** No built-in or saved profile has that name. */
  | "unknown_profile"
  | "unreadable_file"
  /** The worker took too long and was stopped. */
  | "timeout"
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

/**
 * The profile an import uses, by how it was chosen: a built-in or a saved one
 * by name (the server has its definition), or a new definition, which is saved
 * once the import succeeded. A new one can neither take a built-in's name nor
 * a saved one's, unless `replace` says to overwrite the saved one.
 */
export const profileChoiceSchema = z.union([
  z.object({ builtin: z.string() }),
  z.object({ saved: z.string() }),
  z.object({ custom: sourceProfileSchema, replace: z.boolean().optional() }),
]);
export type ProfileChoice =
  | { builtin: string }
  | { saved: string }
  | { custom: SourceProfile; replace?: boolean };

/**
 * Built-in profiles of Bamboo report exports whose rows can be imported as
 * historical review cycles (domain mode) instead of only landed.
 */
export const HISTORY_PROFILES: readonly string[] = [
  "bamboo-employee-performance",
  "bamboo-feedback-status",
];

/** What the import action and the upload worker take. */
export const importInputSchema = z.object({
  uploadId: z.string(),
  fileName: z.string().max(255),
  profile: profileChoiceSchema,
  /**
   * History profiles only: land the rows in raw_record without creating
   * cycles. Every other profile is always landed.
   */
  landing: z.boolean().optional(),
});

/** What is inside an upload: detected columns (with types) and a few rows. */
export type UploadInspection = {
  columns: LakeColumn[];
  /** The first rows (see {@link PREVIEW_ROWS}), ordered by the first column. */
  rows: LakeRow[];
};

/** What an import did: its run and counts, and the first rejected rows. */
export type ImportUploadResult = {
  runId: string;
  counts: IngestCounts;
  /** The first rejected rows; all of them stay on the run. */
  rejects: IngestReject[];
  /** `domain`: imported as historical cycles; `landing`: rows only landed. */
  mode?: "domain" | "landing";
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
export type ImportResult = ({ ok: true } & ImportUploadResult) | UploadFailure;
