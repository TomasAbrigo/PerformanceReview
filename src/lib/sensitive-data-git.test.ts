// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findSensitiveFiles } from "./sensitive-data";
import {
  readStaged,
  readTracked,
  stagedPaths,
  trackedPaths,
} from "./sensitive-data-git";

// Assembled at run time: this file is scanned by the repo-wide test too.
const foreign = ["someone", ["gmail", "com"].join(".")].join("@");

let repo: string;
// Inside a git hook GIT_DIR / GIT_INDEX_FILE point at the real repository.
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, env, stdio: "pipe" });
const write = (path: string, content: string | Buffer) => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "sensitive-data-"));
  git("init", "--quiet");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("staged files", () => {
  it("lists only what is in the index, with the staged content", () => {
    write("export.csv", "a,b\n1,2\n");
    write("notes.md", `contact ${foreign}\n`);
    write("clean.ts", "export const a = 1;\n");
    write("untracked.txt", "never added");
    git("add", "export.csv", "notes.md", "clean.ts");
    // Edited after staging: the commit would still carry the staged version.
    write("notes.md", "now clean\n");

    expect(stagedPaths(repo, env).sort()).toEqual([
      "clean.ts",
      "export.csv",
      "notes.md",
    ]);
    const issues = findSensitiveFiles(
      readStaged(stagedPaths(repo, env), repo, env),
    );
    expect(issues.map((i) => [i.kind, i.path])).toEqual([
      ["data-file", "export.csv"],
      ["email", "notes.md"],
    ]);
  });

  it("is empty when nothing is staged", () => {
    write("notes.md", `contact ${foreign}\n`);
    expect(stagedPaths(repo, env)).toEqual([]);
    expect(findSensitiveFiles(readStaged([], repo, env))).toEqual([]);
  });

  it("leaves binary files unread", () => {
    write("blob.dat", Buffer.from([0x89, 0x00, 0x01, 0x02]));
    write("logo.png", Buffer.from(foreign));
    git("add", "blob.dat", "logo.png");
    expect(readStaged(stagedPaths(repo, env), repo, env)).toEqual([
      { path: "blob.dat", content: undefined },
      { path: "logo.png" },
    ]);
  });

  it("does not list a staged deletion", () => {
    write("old.csv", "a\n");
    git("add", "old.csv");
    git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "commit",
      "--quiet",
      "-m",
      "x",
    );
    git("rm", "--quiet", "old.csv");
    expect(stagedPaths(repo, env)).toEqual([]);
  });
});

describe("tracked files", () => {
  it("reads the working tree and tolerates a tracked file that is gone", () => {
    write("a.txt", "hello\n");
    write("b.txt", "bye\n");
    git("add", "a.txt", "b.txt");
    rmSync(join(repo, "b.txt"));
    expect(readTracked(trackedPaths(repo), repo)).toEqual([
      { path: "a.txt", content: "hello\n" },
      { path: "b.txt" },
    ]);
  });
});
