import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SensitiveFile } from "./sensitive-data";

/** `cwd` is the repository root when run from it; `env` lets tests isolate git. */
const git = (args: string[], cwd: string, env: NodeJS.ProcessEnv): Buffer =>
  execFileSync("git", args, { cwd, env, maxBuffer: 256 * 1024 * 1024 });

const splitZ = (out: Buffer): string[] =>
  out
    .toString("utf8")
    .split("\0")
    .filter((p) => p !== "");

/** Files git tracks (what CI and clones get). */
export function trackedPaths(cwd = process.cwd(), env = process.env): string[] {
  return splitZ(git(["ls-files", "-z"], cwd, env));
}

/** Files added, copied, modified or renamed in the index (what a commit would add). */
export function stagedPaths(cwd = process.cwd(), env = process.env): string[] {
  return splitZ(
    git(
      ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
      cwd,
      env,
    ),
  );
}

/** Extensions never read as text. */
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|zip|gz|xlsx|xls|parquet)$/i;

/** Text of a buffer, or undefined when it looks binary (a NUL in the first 8 KB). */
const textOf = (bytes: Buffer): string | undefined =>
  bytes.subarray(0, 8192).includes(0) ? undefined : bytes.toString("utf8");

function readAll(
  paths: string[],
  read: (path: string) => Buffer,
): SensitiveFile[] {
  return paths.map((path) => {
    if (BINARY_EXT.test(path)) return { path };
    try {
      return { path, content: textOf(read(path)) };
    } catch {
      // Tracked but gone from the working tree, or unreadable: nothing to scan.
      return { path };
    }
  });
}

/** The working-tree contents of tracked files. */
export function readTracked(
  paths: string[],
  cwd = process.cwd(),
): SensitiveFile[] {
  return readAll(paths, (path) => readFileSync(join(cwd, path)));
}

/** The contents staged for the next commit (not the working tree). */
export function readStaged(
  paths: string[],
  cwd = process.cwd(),
  env = process.env,
): SensitiveFile[] {
  return readAll(paths, (path) => git(["show", `:${path}`], cwd, env));
}
