import { spawn } from "node:child_process";
import type { UploadFailure } from "./upload-shared";

/**
 * Runs `scripts/ingest-upload.ts` in its own Node process, so reading a file
 * with DuckDB and ingesting it never happens inside a request handler (the
 * app only stores the file and waits for the worker's answer).
 *
 * The worker reads one JSON input from stdin and prints one JSON line on
 * stdout: `{ ok: true, ...result }` or `{ ok: false, code, message, issues }`.
 * Failures the user can act on come back as data; a worker that crashes is
 * code "unknown", one that took too long (it is stopped) is code "timeout".
 */

export type WorkerCommand = "inspect" | "import";

export type WorkerResponse<T extends object> =
  ({ ok: true } & T) | UploadFailure;

export type WorkerOptions = {
  /** Extra environment for the worker (it inherits the current one). */
  env?: Record<string, string | undefined>;
  /** Stop the worker after this long. Default 10 minutes. */
  timeoutMs?: number;
  /**
   * How long a worker told to stop (SIGTERM, so it can mark its run as failed)
   * has to exit before it is killed. Default 10 seconds.
   */
  graceMs?: number;
  /** The worker script (a stand-in in tests). */
  script?: string;
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_GRACE_MS = 10 * 1000;

const failure = (
  message: string,
  code: UploadFailure["code"] = "unknown",
): UploadFailure => ({ ok: false, code, message, issues: [] });

export function runUploadWorker<T extends object>(
  command: WorkerCommand,
  input: unknown,
  {
    env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    graceMs = DEFAULT_GRACE_MS,
    script = "scripts/ingest-upload.ts",
  }: WorkerOptions = {},
): Promise<WorkerResponse<T>> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", script, command],
      { cwd: process.cwd(), env: { ...process.env, ...env } },
    );
    // Decoded as a stream: a multi-byte character can be split between chunks.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      // Politely first: the worker marks its run as failed before it exits.
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), graceMs);
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
    };

    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => {
      done();
      resolve(failure(`Could not start the upload worker: ${error.message}`));
    });
    child.on("close", () => {
      done();
      if (timedOut) {
        resolve(
          failure(
            `The upload worker timed out after ${timeoutMs} ms`,
            "timeout",
          ),
        );
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
