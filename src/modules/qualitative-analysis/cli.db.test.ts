import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { importLabelsCli, parseRunArgs, runAnalysisCli } from "./cli";
import { resetQualitative } from "./test-support";

const lines = () => {
  const out: string[] = [];
  return { out, push: (l: string) => out.push(l) };
};

beforeAll(resetQualitative);
afterAll(closeDb);

describe("analysis CLI", () => {
  it("validates arguments", () => {
    expect(() => parseRunArgs(["--cycle", "x"])).toThrow(/uuid/);
    expect(() => parseRunArgs(["--provider", "gpt"])).toThrow(
      /mock or anthropic/,
    );
    expect(() => parseRunArgs(["--nope"])).toThrow();
  });

  it("runs the mock (exit 0) and exits 2 for anthropic without a key", async () => {
    const o = lines();
    expect(await runAnalysisCli([], { db, env: {}, stdout: o.push })).toBe(0);
    expect(o.out[0]).toMatch(/^analysis mock: 0 texts/);
    const e = lines();
    expect(
      await runAnalysisCli(["--provider", "anthropic"], {
        db,
        env: {},
        stderr: e.push,
      }),
    ).toBe(2);
    expect(e.out[0]).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("imports labels from a file and lists unmatched rows", async () => {
    const o = lines();
    const code = await importLabelsCli(
      [path.resolve("fixtures/qualitative-labels/small.csv")],
      { db, env: {}, stdout: o.push },
    );
    expect(code).toBe(0);
    expect(o.out[0]).toMatch(/6 rows, 0 matched, 6 unmatched/);
    expect(await importLabelsCli([], { db, env: {}, stderr: () => {} })).toBe(
      2,
    );
  });
});
