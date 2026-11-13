import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { ingestRun, rawRecord } from "@/db/schema";
import { FixtureAdapter } from "./fixture-adapter";
import { runIngest } from "./run-ingest";
import { getRun, listRunEntities, listRuns } from "./runs-queries";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

async function reset() {
  await db.execute(
    sql`TRUNCATE source_identity, employment, person, raw_record, ingest_run, sync_state CASCADE`,
  );
}

type NewRun = {
  sourceSystem?: string;
  adapter?: string;
  entity?: string;
  status?: string;
  /** ISO instant, may carry microseconds. */
  startedAt: string;
  counts?: Record<string, number>;
  rejects?: { sourceId: string | null; reason: string }[];
  error?: string;
};

async function insertRun(r: NewRun): Promise<string> {
  const [row] = await db
    .insert(ingestRun)
    .values({
      sourceSystem: r.sourceSystem ?? "bamboo_api",
      adapter: r.adapter ?? "fixture",
      params: { entity: r.entity ?? "employee" },
      status: r.status ?? "succeeded",
      startedAt: sql`${r.startedAt}::timestamptz`,
      counts: r.counts,
      rejects: r.rejects,
      error: r.error,
    })
    .returning({ id: ingestRun.id });
  return row.id;
}

async function pageThrough(limit: number, filters = {}) {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard++) {
    const page = await listRuns(db, { ...filters, limit, cursor });
    ids.push(...page.runs.map((r) => r.id));
    if (!page.nextCursor) return ids;
    cursor = page.nextCursor;
  }
  throw new Error("pagination did not terminate");
}

describe("listRuns", () => {
  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await closeDb();
  });

  it("lists newest first with entity, counts and the number of issues", async () => {
    await insertRun({ startedAt: "2026-11-01T10:00:00Z", entity: "goal" });
    const newest = await insertRun({
      startedAt: "2026-11-02T10:00:00Z",
      counts: { read: 5, inserted: 2, unchanged: 3 },
      rejects: [
        { sourceId: "7", reason: "employee has no name" },
        { sourceId: null, reason: "bad row" },
      ],
    });

    const { runs, nextCursor } = await listRuns(db, { limit: 10 });

    expect(runs).toHaveLength(2);
    expect(nextCursor).toBeNull();
    expect(runs[0]).toMatchObject({
      id: newest,
      sourceSystem: "bamboo_api",
      adapter: "fixture",
      entity: "employee",
      status: "succeeded",
      counts: { read: 5, inserted: 2, unchanged: 3 },
      issues: 2,
    });
    expect(runs[0].startedAt).toEqual(new Date("2026-11-02T10:00:00Z"));
    expect(runs[1]).toMatchObject({ entity: "goal", issues: 0, counts: {} });
  });

  it("filters by source, entity and status, alone or combined", async () => {
    await insertRun({ startedAt: "2026-11-01T10:00:00Z" });
    const lake = await insertRun({
      startedAt: "2026-11-01T11:00:00Z",
      sourceSystem: "lake",
      adapter: "lake-file",
    });
    const goal = await insertRun({
      startedAt: "2026-11-01T12:00:00Z",
      entity: "goal",
    });
    const failed = await insertRun({
      startedAt: "2026-11-01T13:00:00Z",
      status: "error",
      error: "boom",
    });
    const ids = (filters: object) =>
      listRuns(db, { limit: 10, ...filters }).then((p) =>
        p.runs.map((r) => r.id),
      );

    expect(await ids({ source: "lake" })).toEqual([lake]);
    expect(await ids({ entity: "goal" })).toEqual([goal]);
    expect(await ids({ status: "error" })).toEqual([failed]);
    expect(
      await ids({ source: "bamboo_api", entity: "employee" }),
    ).toHaveLength(2);
    expect(
      await ids({ source: "bamboo_api", entity: "employee", status: "error" }),
    ).toEqual([failed]);
    expect(await ids({ source: "native" })).toEqual([]);
  });

  it("pages are stable: no gaps or repeats, even with identical start times", async () => {
    const expected: string[] = [];
    // Same instant (one transaction's now()), and instants a microsecond apart.
    for (let i = 0; i < 4; i++) {
      expected.push(await insertRun({ startedAt: "2026-11-01T10:00:00Z" }));
    }
    expected.push(
      await insertRun({ startedAt: "2026-11-01T10:00:00.000100Z" }),
    );
    expected.push(
      await insertRun({ startedAt: "2026-11-01T10:00:00.000200Z" }),
    );
    expected.push(
      await insertRun({ startedAt: "2026-11-01T10:00:00.000300Z" }),
    );

    const all = (await listRuns(db, { limit: 50 })).runs.map((r) => r.id);
    expect(new Set(all).size).toBe(7);

    for (const limit of [1, 2, 3, 7, 8]) {
      expect(await pageThrough(limit)).toEqual(all);
    }
  });

  it("a run that starts between two page requests does not shift the next page", async () => {
    for (let i = 1; i <= 5; i++) {
      await insertRun({ startedAt: `2026-11-01T10:00:0${i}Z` });
    }
    const first = await listRuns(db, { limit: 2 });
    expect(first.nextCursor).not.toBeNull();

    await insertRun({ startedAt: "2026-11-02T00:00:00Z" });

    const second = await listRuns(db, { limit: 2, cursor: first.nextCursor });
    const seen = new Set(first.runs.map((r) => r.id));
    expect(second.runs.some((r) => seen.has(r.id))).toBe(false);
    expect(second.runs.map((r) => r.startedAt?.toISOString())).toEqual([
      "2026-11-01T10:00:03.000Z",
      "2026-11-01T10:00:02.000Z",
    ]);
  });

  it("pages within a filter", async () => {
    for (let i = 1; i <= 5; i++) {
      await insertRun({
        startedAt: `2026-11-01T10:00:0${i}Z`,
        status: i % 2 ? "succeeded" : "error",
      });
    }
    const errors = await pageThrough(1, { status: "error" });
    expect(errors).toHaveLength(2);
  });

  it("ignores a cursor it cannot read and starts from the top", async () => {
    const id = await insertRun({ startedAt: "2026-11-01T10:00:00Z" });
    const page = await listRuns(db, { limit: 5, cursor: "not-a-cursor" });
    expect(page.runs.map((r) => r.id)).toEqual([id]);
  });

  it("lists the entities that have runs", async () => {
    await insertRun({ startedAt: "2026-11-01T10:00:00Z", entity: "goal" });
    await insertRun({ startedAt: "2026-11-01T11:00:00Z", entity: "employee" });
    await insertRun({ startedAt: "2026-11-01T12:00:00Z", entity: "goal" });

    expect(await listRunEntities(db)).toEqual(["employee", "goal"]);
  });
});

describe("getRun", () => {
  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await closeDb();
  });

  it("returns the run with its rejects, params and raw record count", async () => {
    const id = await insertRun({
      startedAt: "2026-11-01T10:00:00Z",
      counts: { read: 4, inserted: 3, rejected: 1 },
      rejects: [{ sourceId: "105", reason: "employee has no name" }],
    });
    await db.insert(rawRecord).values(
      ["1", "2", "3"].map((sourceId) => ({
        runId: id,
        sourceSystem: "bamboo_api" as const,
        entity: "employee",
        sourceId,
        payload: { id: sourceId },
        payloadHash: `h${sourceId}`,
        extractedAt: new Date(),
      })),
    );

    const run = await getRun(db, id);

    expect(run).toMatchObject({
      id,
      entity: "employee",
      adapter: "fixture",
      status: "succeeded",
      params: { entity: "employee" },
      counts: { read: 4, inserted: 3, rejected: 1 },
      rejects: [{ sourceId: "105", reason: "employee has no name" }],
      rawRecordCount: 3,
      error: null,
    });
  });

  it("returns null for an unknown or malformed id", async () => {
    expect(await getRun(db, "7f3c1c58-0000-4000-8000-000000000000")).toBeNull();
    expect(await getRun(db, "nope")).toBeNull();
  });

  it("shows the exact counts and rejects of a real run, and the error of a failed one", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "runs-queries-"));
    try {
      await cp(FIXTURES, dir, { recursive: true });
      const page2 = path.join(dir, "employees-page-2.json");
      const body = JSON.parse(await readFile(page2, "utf8"));
      body.data.push({ id: 105, displayName: null, firstName: null });
      await writeFile(page2, JSON.stringify(body));

      const { runId, counts } = await runIngest({
        adapter: new FixtureAdapter(dir),
        entity: "employee",
        db,
      });

      const run = await getRun(db, runId);
      expect(run?.counts).toEqual(counts);
      expect(run).toMatchObject({
        counts: { read: 4, inserted: 3, rejected: 1 },
        rejects: [{ sourceId: "105", reason: expect.any(String) }],
        rawRecordCount: 4,
        status: "succeeded",
      });
      expect(run?.finishedAt).toBeInstanceOf(Date);

      await writeFile(path.join(dir, "employees-page-1.json"), "{not json");
      const failure = await runIngest({
        adapter: new FixtureAdapter(dir),
        entity: "employee",
        db,
      }).catch((e: { runId: string }) => e);
      const failed = await getRun(db, (failure as { runId: string }).runId);
      expect(failed).toMatchObject({ status: "error" });
      expect(failed?.error).toEqual(expect.any(String));
      expect(failed?.finishedAt).toBeInstanceOf(Date);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
