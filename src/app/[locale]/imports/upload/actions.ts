"use server";

import { db } from "@/db/client";
import { storeUpload, UploadError } from "@/modules/lake/upload-store";
import type { z } from "zod";
import {
  importInputSchema,
  UPLOAD_MAX_BYTES,
  type ImportResult,
  type ImportUploadResult,
  type InspectResult,
  type UploadFailure,
  type UploadInspection,
} from "@/modules/lake/upload-shared";
import { markUploadRunsFailed } from "@/modules/lake/upload-runs";
import { runUploadWorker } from "@/modules/lake/upload-worker";

/**
 * The upload screen's server actions. They only move bytes and ask the upload
 * worker (a separate process) to read or ingest the file: DuckDB and the
 * ingest never run inside the request.
 */

const fail = (
  code: UploadFailure["code"],
  message: string,
  issues: UploadFailure["issues"] = [],
): UploadFailure => ({ ok: false, code, message, issues });

/** Store the uploaded file and look inside it (columns, first rows). */
export async function inspectUploadAction(
  formData: FormData,
): Promise<InspectResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.name === "") {
    return fail("no_file", "No file in the request");
  }
  // Checked before reading the bytes into memory.
  if (file.size > UPLOAD_MAX_BYTES) {
    return fail("file_too_large", `The file is ${file.size} bytes`);
  }

  let stored;
  try {
    stored = await storeUpload({
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  } catch (error) {
    if (error instanceof UploadError) return fail(error.code, error.message);
    console.error(error);
    return fail("unknown", "The file could not be stored");
  }

  const response = await runUploadWorker<UploadInspection>("inspect", {
    uploadId: stored.id,
  });
  if (!response.ok) return response;
  return {
    ok: true,
    uploadId: stored.id,
    fileName: file.name,
    size: stored.size,
    existed: stored.existed,
    columns: response.columns,
    rows: response.rows,
  };
}

/** Land an uploaded file's rows in raw_record with a profile (landing only). */
export async function importUploadAction(
  input: z.input<typeof importInputSchema>,
): Promise<ImportResult> {
  const parsed = importInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "invalid_profile_definition",
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  // (A little before: the database and this process may not agree to the ms.)
  const startedAt = new Date(Date.now() - 2000);
  const response = await runUploadWorker<ImportUploadResult>(
    "import",
    parsed.data,
  );
  if (!response.ok && response.code === "timeout") {
    // The worker marks its own run as failed when it is told to stop; if it
    // had to be killed instead, nobody did.
    const sha256 = /^[0-9a-f]{64}/.exec(parsed.data.uploadId)?.[0];
    if (sha256) {
      await markUploadRunsFailed(db, {
        sha256,
        since: startedAt,
        message: response.message,
      }).catch((error: unknown) => console.error(error));
    }
  }
  if (!response.ok) return response;
  return {
    ok: true,
    runId: response.runId,
    counts: response.counts,
    rejects: response.rejects,
  };
}
