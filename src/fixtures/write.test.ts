import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FIXTURE_SEEDS, fixtureFiles, writeFixtures } from "./write";

// Vitest runs from the repo root.
const repoFixtures = join(process.cwd(), "fixtures");
const scratch: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fixtures-test-"));
  scratch.push(dir);
  return dir;
}

function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[relative(root, full)] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return out;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe("fixture layout", () => {
  it("puts API JSON under bamboo/<size> and report CSVs under bamboo-reports/<size>", () => {
    for (const size of ["small", "demo"] as const) {
      const paths = fixtureFiles(size).map((f) => f.path);
      expect(paths).toContain(`bamboo/${size}/employees/changed.json`);
      expect(paths).toContain(`bamboo/${size}/employees/tables/jobInfo/all.json`);
      expect(paths).toContain(`bamboo/${size}/manifest.json`);
      for (const report of [
        "employee-performance",
        "feedback-status",
        "goal-status",
        "assessment-progress",
      ]) {
        expect(paths).toContain(`bamboo-reports/${size}/${report}.csv`);
      }
      expect(new Set(paths).size).toBe(paths.length);
    }
  });

  it("describes the dataset in a manifest with the seed and headline counts", () => {
    const file = fixtureFiles("small").find((f) => f.path === "bamboo/small/manifest.json")!;
    const manifest = JSON.parse(file.content);
    expect(manifest).toMatchObject({
      size: "small",
      seed: FIXTURE_SEEDS.small,
      counts: { employees: 40 },
    });
    expect(manifest.counts.terminations).toBeGreaterThanOrEqual(10);
    expect(manifest.counts.rehires).toBeGreaterThanOrEqual(3);
    expect(manifest.counts.managerChanges).toBeGreaterThanOrEqual(20);
    expect(manifest.cycles).toHaveLength(3);
  });
});

describe("writeFixtures", () => {
  it("writes byte-identical trees on every run and drops stale files", () => {
    const a = tempDir();
    const b = tempDir();
    writeFixtures(a, ["small"]);
    mkdirSync(join(b, "bamboo/small/employees/get"), { recursive: true });
    writeFileSync(join(b, "bamboo/small/employees/get/999999.json"), "stale");
    writeFixtures(b, ["small"]);
    expect(tree(b)).toEqual(tree(a));
    expect(Object.keys(tree(a)).length).toBe(fixtureFiles("small").length);
  });
});

describe("committed fixtures", () => {
  it.each(["small", "demo"] as const)(
    "%s fixtures in the repo are up to date (run `pnpm fixtures:build`)",
    (size) => {
      const expected = Object.fromEntries(fixtureFiles(size).map((f) => [f.path, f.content]));
      const onDisk = Object.fromEntries(
        Object.entries(tree(repoFixtures)).filter(
          ([path]) => path.startsWith(`bamboo/${size}/`) || path.startsWith(`bamboo-reports/${size}/`),
        ),
      );
      expect(Object.keys(onDisk).sort()).toEqual(Object.keys(expected).sort());
      expect(onDisk).toEqual(expected);
    },
  );
});
