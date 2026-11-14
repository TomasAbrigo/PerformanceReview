/**
 * Upload worker: reads one JSON input on stdin, prints one JSON line on stdout.
 * Spawned by the app (src/modules/lake/upload-worker.ts) so DuckDB and the
 * ingest run outside the request handler; it can also be run by hand:
 *
 *   echo '{"uploadId":"<sha256>.csv"}' | pnpm exec tsx scripts/ingest-upload.ts inspect
 *   echo '{"uploadId":"...","fileName":"a.csv","profile":{...}}' | pnpm exec tsx scripts/ingest-upload.ts import
 *
 * `profile` is `{ builtin: name }`, `{ saved: name }` or `{ custom: {...} }`
 * (see ProfileChoice). Uploads live in var/uploads (UPLOADS_DIR), custom
 * profiles in var/profiles (PROFILES_DIR). `import` needs DATABASE_URL.
 *
 * On SIGTERM (the app gives up on a worker that takes too long) the run in
 * progress is stopped and marked as failed before the process exits.
 */
import { z } from "zod";
import { closeDb, db } from "../src/db/client";
import { importInputSchema } from "../src/modules/lake/upload-shared";
import {
  importUpload,
  inspectUpload,
  UploadError,
} from "../src/modules/lake/upload";

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the real environment
}

const inspectInput = z.object({ uploadId: z.string() });

/** Aborted on SIGTERM: the ingest sees it at the next row. */
const stop = new AbortController();
process.once("SIGTERM", () =>
  stop.abort(new Error("The upload worker was terminated: it took too long")),
);

async function readStdin(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function run(command: string | undefined, input: unknown) {
  if (command === "inspect") {
    const { uploadId } = inspectInput.parse(input);
    return inspectUpload(uploadId);
  }
  if (command === "import") {
    const { uploadId, fileName, profile } = importInputSchema.parse(input);
    return importUpload({
      uploadId,
      fileName,
      profile,
      db,
      signal: stop.signal,
    });
  }
  throw new Error(`Unknown command "${command}": use inspect or import`);
}

async function main() {
  let response: Record<string, unknown>;
  try {
    response = { ok: true, ...(await run(process.argv[2], await readStdin())) };
  } catch (error) {
    if (error instanceof UploadError) {
      response = {
        ok: false,
        code: error.code,
        message: error.message,
        issues: error.issues,
      };
    } else if (stop.signal.aborted) {
      // The run was stopped (and marked as failed) by the ingest itself.
      response = {
        ok: false,
        code: "timeout",
        message: error instanceof Error ? error.message : String(error),
        issues: [],
      };
    } else {
      // Unexpected: say so on stderr too, so the app's logs have the stack.
      console.error(error);
      response = {
        ok: false,
        code: "unknown",
        message: error instanceof Error ? error.message : String(error),
        issues: [],
      };
    }
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
