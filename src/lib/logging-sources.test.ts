import { describe, expect, it } from "vitest";
import { readTracked, trackedPaths } from "./sensitive-data-git";

/**
 * Nothing logs an email: a grep over the sources. Unexpected errors go
 * through `logError` (`src/lib/log.ts`), which redacts addresses, because a
 * driver error can carry the row it choked on (`Key (work_email)=(...)`).
 */

const CLOSERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** Index just past the string literal that starts at `start` (a quote or backtick). */
function skipString(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote) {
    i += text[i] === "\\" ? 2 : 1;
  }
  return i + 1;
}

/**
 * Index of the bracket that closes the one at `open`, skipping string
 * literals (so a `;` or `)` inside a string does not count); -1 if unbalanced.
 */
function closingIndex(text: string, open: number): number {
  const stack: string[] = [];
  for (let i = open; i < text.length;) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i);
      continue;
    }
    if (c in CLOSERS) stack.push(CLOSERS[c]);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/** Every `console.x(...)` call, bracket-balanced: `[method, argument text]`. */
export function consoleCalls(content: string): [string, string][] {
  const calls: [string, string][] = [];
  for (const m of content.matchAll(/\bconsole\.(\w+)\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = closingIndex(content, open);
    if (close !== -1) calls.push([m[1], content.slice(open + 1, close)]);
  }
  return calls;
}

/** The top-level arguments of a call's argument text. */
export function topLevelArgs(args: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < args.length;) {
    const c = args[i];
    if (c === '"' || c === "'" || c === "`") i = skipString(args, i);
    else if (c in CLOSERS) {
      const close = closingIndex(args, i);
      i = close === -1 ? args.length : close + 1;
    } else if (c === ",") {
      parts.push(args.slice(start, i).trim());
      start = ++i;
    } else i += 1;
  }
  parts.push(args.slice(start).trim());
  return parts.filter((p) => p !== "");
}

/** An argument that is a bare error value (what a driver error rides in on). */
const RAW_ERROR = /^(error|err|e|ex|exception|cause|reason)$|\.cause$/;

describe("the scanner", () => {
  it("balances brackets and ignores semicolons and parens inside strings", () => {
    const calls = consoleCalls(
      'console.error("failed; retry (1)", error); other(); console.log(`a;${b})`);',
    );
    expect(calls).toEqual([
      ["error", '"failed; retry (1)", error'],
      ["log", "`a;${b})`"],
    ]);
    expect(topLevelArgs('"failed; retry (1)", error')).toEqual([
      '"failed; retry (1)"',
      "error",
    ]);
  });

  it("splits only at top-level commas", () => {
    expect(topLevelArgs("fmt(a, b), { x: [1, 2] }, err")).toEqual([
      "fmt(a, b)",
      "{ x: [1, 2] }",
      "err",
    ]);
  });

  it("skips escaped quotes and reports unbalanced calls as none", () => {
    expect(consoleCalls('console.warn("say \\"hi;\\"", e);')).toEqual([
      ["warn", '"say \\"hi;\\"", e'],
    ]);
    expect(consoleCalls("console.log(oops")).toEqual([]);
  });
});

// Tracked application and script sources, read once for every test below.
const sources = readTracked(
  trackedPaths(undefined, undefined, ["src", "scripts"]).filter(
    (path) =>
      /\.tsx?$/.test(path) &&
      !/\.test\.tsx?$/.test(path) &&
      !path.startsWith("src/fixtures/") &&
      path !== "src/lib/log.ts",
  ),
)
  .filter(({ content }) => content !== undefined)
  .map(({ path, content }) => ({ path, calls: consoleCalls(content!) }));

describe("logging", () => {
  it("scans the application and script sources", () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.some((s) => s.calls.length > 0)).toBe(true);
  });

  it("never passes an email field to console", () => {
    const offenders = sources.flatMap(({ path, calls }) =>
      calls
        .filter(([, args]) => /e-?mail/i.test(args))
        .map(([method, args]) => `${path}: console.${method}(${args})`),
    );
    expect(offenders).toEqual([]);
  });

  it("never logs a raw error object (use logError, which redacts)", () => {
    const offenders = sources.flatMap(({ path, calls }) =>
      calls
        .filter(([, args]) =>
          topLevelArgs(args).some((arg) => RAW_ERROR.test(arg)),
        )
        .map(([method, args]) => `${path}: console.${method}(${args})`),
    );
    expect(offenders).toEqual([]);
  });
});
