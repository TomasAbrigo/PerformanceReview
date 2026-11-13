import { describe, expect, it } from "vitest";
import {
  assertLocalDatabase,
  formatSeedSummary,
  parseSeedArgs,
  type SeedRun,
} from "./seed";

describe("parseSeedArgs", () => {
  it("defaults to the small size without reset", () => {
    expect(parseSeedArgs([])).toEqual({ size: "small", reset: false });
  });

  it("reads --size and --reset", () => {
    expect(parseSeedArgs(["--size", "demo", "--reset"])).toEqual({
      size: "demo",
      reset: true,
    });
    expect(parseSeedArgs(["--size=small"])).toEqual({
      size: "small",
      reset: false,
    });
  });

  it("rejects an unknown size, an unknown flag and stray arguments", () => {
    expect(() => parseSeedArgs(["--size", "huge"])).toThrow(
      "--size must be small or demo (got huge)",
    );
    expect(() => parseSeedArgs(["--wipe"])).toThrow();
    expect(() => parseSeedArgs(["small"])).toThrow();
  });
});

describe("assertLocalDatabase", () => {
  it.each([
    "postgresql://postgres:postgres@127.0.0.1:55322/postgres",
    "postgresql://postgres:postgres@localhost:5432/postgres",
    "postgresql://postgres:postgres@[::1]:5432/postgres",
  ])("accepts %s", (url) => {
    expect(() => assertLocalDatabase(url)).not.toThrow();
  });

  it.each([
    "postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres",
    "postgresql://u:p@10.0.0.5:5432/postgres",
    "not a url",
    "",
    undefined,
  ])("refuses %s", (url) => {
    expect(() => assertLocalDatabase(url)).toThrow(/not local/);
  });
});

describe("formatSeedSummary", () => {
  const run = (entity: string, over: Partial<SeedRun["counts"]> = {}) =>
    ({
      entity,
      runId: `run-${entity}`,
      issues: 0,
      counts: {
        read: 40,
        inserted: 40,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        deleted: 0,
        ...over,
      },
    }) satisfies SeedRun;

  it("prints one aligned row per pipeline with the run id last", () => {
    const table = formatSeedSummary([
      run("employee"),
      { ...run("goal", { read: 117, inserted: 0, unchanged: 117 }), issues: 2 },
    ]).split("\n");

    expect(table[0].split(/\s+/)).toEqual([
      "entity",
      "read",
      "inserted",
      "updated",
      "unchanged",
      "rejected",
      "issues",
      "run",
    ]);
    expect(table[1].split(/\s+/)).toEqual([
      "employee",
      "40",
      "40",
      "0",
      "0",
      "0",
      "0",
      "run-employee",
    ]);
    expect(table[2].split(/\s+/)).toEqual([
      "goal",
      "117",
      "0",
      "0",
      "117",
      "0",
      "2",
      "run-goal",
    ]);
  });
});
