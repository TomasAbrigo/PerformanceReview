import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { ingestRun, person, syncState } from "@/db/schema";

type Result = { code: number; stdout: string; stderr: string };

/** Spawns `scripts/ingest.ts` like cron would. */
function ingest(args: string[], env: Record<string, string> = {}) {
  return new Promise<Result>((resolve) => {
    execFile(
      "pnpm",
      ["exec", "tsx", "scripts/ingest.ts", ...args],
      { env: { ...process.env, ...env } },
      (error, stdout, stderr) =>
        resolve({
          code: error ? ((error as { code?: number }).code ?? 1) : 0,
          stdout,
          stderr,
        }),
    );
  });
}

const lastRun = () =>
  db
    .select()
    .from(ingestRun)
    .orderBy(desc(ingestRun.startedAt))
    .limit(1)
    .then(([r]) => r);

describe("scripts/ingest.ts", () => {
  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE source_identity, employment, person, raw_record, ingest_run, sync_state CASCADE`,
    );
  });
  afterAll(async () => {
    await db.execute(
      sql`TRUNCATE source_identity, employment, person, raw_record, ingest_run, sync_state CASCADE`,
    );
    await closeDb();
  });

  it("runs employee against the fixtures, exits 0 and records the run and the watermark", async () => {
    const { code, stdout, stderr } = await ingest([
      "employee",
      "--source",
      "fixture",
    ]);

    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    const [header, row] = stdout.trim().split("\n");
    expect(header).toMatch(/^entity\s+adapter\s+status\s+read/);
    expect(row.split(/\s+/).slice(0, 9)).toEqual([
      "employee",
      "fixture",
      "succeeded",
      "3",
      "3",
      "0",
      "0",
      "0",
      "0",
    ]);

    const run = await lastRun();
    expect(run).toMatchObject({
      status: "succeeded",
      adapter: "fixture",
      params: { entity: "employee", source: "fixture" },
    });
    expect(stdout).toContain(run.id);
    expect(await db.select().from(person)).toHaveLength(3);
    const [state] = await db.select().from(syncState);
    expect(state).toMatchObject({ entity: "employee", lastRunId: run.id });
  });

  it("--all runs every registered entity, employees first", async () => {
    const { code, stdout } = await ingest(["--all", "--source", "fixture"]);

    expect(code).toBe(0);
    expect(stdout).toMatch(/employee\s+fixture\s+succeeded/);
    expect(stdout).toMatch(/job_history\s+fixture\s+succeeded/);
    expect(stdout).toMatch(/goal\s+fixture\s+succeeded/);
    expect(stdout.indexOf("employee")).toBeLessThan(
      stdout.indexOf("job_history"),
    );
    expect(stdout.indexOf("employee")).toBeLessThan(stdout.indexOf("goal"));
    const states = await db.select().from(syncState);
    expect(states.map((s) => s.entity).sort()).toEqual([
      "employee",
      "goal",
      "job_history",
    ]);
    expect(states.every((s) => s.adapter === "fixture")).toBe(true);
  });

  it("a second run is idempotent and `--since last` resumes from the watermark", async () => {
    await ingest(["employee", "--source", "fixture"]);
    const [first] = await db.select().from(syncState);

    const second = await ingest([
      "employee",
      "--source",
      "fixture",
      "--since",
      "last",
    ]);

    expect(second.code).toBe(0);
    const run = await lastRun();
    expect(run.counts).toMatchObject({ read: 3, unchanged: 3, inserted: 0 });
    expect(run.params).toMatchObject({ since: first.watermark });
    const [after] = await db.select().from(syncState);
    expect(after.lastRunId).toBe(run.id);
  });

  it("exits 1 when the run fails and keeps the failed run in the log", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cli-broken-"));
    try {
      await writeFile(path.join(dir, "employees-page-1.json"), "{not json");

      const { code, stdout, stderr } = await ingest([
        "employee",
        "--source",
        "fixture",
        "--dir",
        dir,
      ]);

      expect(code).toBe(1);
      expect(stdout).toMatch(/employee\s+fixture\s+error/);
      const run = await lastRun();
      expect(run).toMatchObject({ status: "error" });
      expect(run.finishedAt).toBeInstanceOf(Date);
      expect(stderr).toContain(run.id);
      expect(await db.select().from(syncState)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 when bamboo is not configured and writes no run", async () => {
    const { code, stderr } = await ingest(["employee", "--source", "bamboo"], {
      BAMBOO_COMPANY_DOMAIN: "",
      BAMBOO_API_KEY: "",
    });

    expect(code).toBe(2);
    expect(stderr).toContain("BAMBOO_API_KEY");
    expect(await db.select().from(ingestRun)).toEqual([]);
  });

  it("exits 2 when DATABASE_URL is not set", async () => {
    // (an empty value is not overridden by .env.local)
    const { code, stderr } = await ingest(["employee", "--source", "fixture"], {
      DATABASE_URL: "",
    });

    expect(code).toBe(2);
    expect(stderr).toContain("DATABASE_URL");
  });

  it("rejects a --since that is not an ISO date or `last`", async () => {
    const { code, stderr } = await ingest([
      "employee",
      "--source",
      "fixture",
      "--since",
      "5",
    ]);

    expect(code).toBe(2);
    expect(stderr).toContain("--since");
    expect(await db.select().from(ingestRun)).toEqual([]);
  });

  it("exits 2 on an unknown entity and writes no run", async () => {
    const { code, stderr } = await ingest(["salary", "--source", "fixture"]);

    expect(code).toBe(2);
    expect(stderr).toContain('Unknown entity "salary"');
    expect(await db.select().from(ingestRun)).toEqual([]);
  });

  it("the ingest:employees alias still works and defaults to the fixtures", async () => {
    const out = await new Promise<Result>((resolve) => {
      execFile(
        "pnpm",
        ["exec", "tsx", "scripts/ingest-employees.ts"],
        { env: process.env },
        (error, stdout, stderr) =>
          resolve({
            code: error ? ((error as { code?: number }).code ?? 1) : 0,
            stdout,
            stderr,
          }),
      );
    });

    expect(out.code).toBe(0);
    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.status, "succeeded"));
    expect(run.params).toMatchObject({ entity: "employee", source: "fixture" });
  });

  it("the alias keeps --entity and --since", async () => {
    await ingest(["employee", "--source", "fixture"]);

    const out = await new Promise<Result>((resolve) => {
      execFile(
        "pnpm",
        [
          "exec",
          "tsx",
          "scripts/ingest-employees.ts",
          "--entity",
          "job_history",
          "--since",
          "2026-01-01T00:00:00Z",
        ],
        { env: process.env },
        (error, stdout, stderr) =>
          resolve({
            code: error ? ((error as { code?: number }).code ?? 1) : 0,
            stdout,
            stderr,
          }),
      );
    });

    expect(out.code).toBe(0);
    const run = await lastRun();
    expect(run).toMatchObject({ status: "succeeded", entity: "job_history" });
    expect(run.params).toMatchObject({
      entity: "job_history",
      since: "2026-01-01T00:00:00.000Z",
    });
  });
});
