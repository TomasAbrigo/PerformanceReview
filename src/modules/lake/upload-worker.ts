import { spawn } from "node:child_process";
import type { UploadFailure } from "./upload-shared";

/**
 * Runs `scripts/ingest-upload.ts` in its own Node process, so reading a file
 * with DuckDB and ingesting it never happens inside a request handler (the
 * app only stores the file and waits for the worker's answer).
 *
 * The worker reads one JSON input from stdin and prints one JSON line on
 * stdout: `{ ok: true, ...result }` or `{ ok: false, code, message, issues }`.
 * Failures the user can act on come back as data; only a crash of the worker
 * itself is reported as code "unknown".
 */

export type WorkerCommand = "inspect" | "import";

export type WorkerResponse<T extends object> =
  ({ ok: true } & T) | UploadFailure;

export type WorkerOptions = {
  /** Extra environment for the worker (it inherits the current one). */
  env?: Record<string, string | undefined>;
  /** Kill the worker after this long. Default 10 minutes. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const failure = (message: string): UploadFailure => ({
  ok: false,
  code: "unknown",
  message,
  issues: [],
});

export function runUploadWorker<T extends object>(
  command: WorkerCommand,
  input: unknown,
  { env, timeoutMs = DEFAULT_TIMEOUT_MS }: WorkerOptions = {},
): Promise<WorkerResponse<T>> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/ingest-upload.ts", command],
      { cwd: process.cwd(), env: { ...process.env, ...env } },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve(failure(`Could not start the upload worker: ${error.message}`));
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (timedOut) {
        resolve(failure(`The upload worker timed out after ${timeoutMs} ms`));
        return;
      }
      resolve(parseResponse<T>(stdout, stderr));
    });

    child.stdin.on("error", () => {}); // the worker may exit before reading
    child.stdin.end(JSON.stringify(input ?? null));
  });
}

/** The last line of stdout is the answer; anything before it is noise. */
function parseResponse<T extends object>(
  stdout: string,
  stderr: string,
): WorkerResponse<T> {
  const last = stdout.trim().split("\n").pop() ?? "";
  try {
    const parsed: unknown = JSON.parse(last);
    if (typeof parsed === "object" && parsed !== null && "ok" in parsed) {
      return parsed as WorkerResponse<T>;
    }
  } catch {
    // fall through to the crash report
  }
  return failure(
    `The upload worker failed: ${stderr.trim().split("\n").slice(-5).join(" ") || "no output"}`,
  );
}
