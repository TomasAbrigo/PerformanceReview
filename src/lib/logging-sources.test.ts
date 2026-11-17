import { describe, expect, it } from "vitest";
import { readTracked, trackedPaths } from "./sensitive-data-git";

/**
 * Nothing logs an email: a grep over the sources. Unexpected errors go
 * through `logError` (`src/lib/log.ts`), which redacts addresses, because a
 * driver error can carry the row it choked on (`Key (work_email)=(...)`).
 */
const sources = readTracked(trackedPaths())
  .filter(
    ({ path, content }) =>
      content !== undefined &&
      /^(src|scripts)\/.*\.tsx?$/.test(path) &&
      !/\.test\.tsx?$/.test(path) &&
      !path.startsWith("src/fixtures/") &&
      path !== "src/lib/log.ts",
  )
  .map(({ path, content }) => ({ path, content: content! }));

/** Every `console.x(...)` call, up to its closing semicolon. */
const consoleCalls = (content: string) =>
  [...content.matchAll(/console\.\w+\([^;]*;/g)].map((m) => m[0]);

describe("logging", () => {
  it("scans the application and script sources", () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.some((s) => consoleCalls(s.content).length > 0)).toBe(true);
  });

  it("never passes an email field to console", () => {
    const offenders = sources.flatMap(({ path, content }) =>
      consoleCalls(content)
        .filter((call) => /e-?mail/i.test(call))
        .map((call) => `${path}: ${call.split("\n")[0]}`),
    );
    expect(offenders).toEqual([]);
  });

  it("never logs a raw error object (use logError, which redacts)", () => {
    const offenders = sources.flatMap(({ path, content }) =>
      consoleCalls(content)
        .filter((call) =>
          /console\.(error|warn|log)\((?:[^()]*,\s*)?(error|err|e|cause)\s*[,)]/.test(
            call,
          ),
        )
        .map((call) => `${path}: ${call.split("\n")[0]}`),
    );
    expect(offenders).toEqual([]);
  });
});
