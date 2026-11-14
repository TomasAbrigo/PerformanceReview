import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { ingestRun, person, rawRecord } from "@/db/schema";
import { IngestRunError, runIngest } from "@/modules/ingest/run-ingest";
import { DuckDbFileLake } from "./duckdb-file-lake";
import { builtinSourceSystem, FileSourceAdapter } from "./file-source-adapter";
import { getBuiltinProfile } from "./profiles";
import type { LakeAdapter } from "./types";

const REPORTS = resolve("fixtures/bamboo-reports/small");

async function landReport(name: string) {
  const profile = getBuiltinProfile(name);
  if (!profile) throw new Error(`no built-in profile ${name}`);
  const lake = await DuckDbFileLake.open(REPORTS);
  try {
    return await runIngest({
      adapter: new FileSourceAdapter(profile, lake, undefined, {
        source: builtinSourceSystem(profile),
      }),
      entity: profile.entity,
      landing: true,
      db,
      params: { profile: profile.name },
    });
  } finally {
    await lake.close();
  }
}

describe("landing a file through FileSourceAdapter", () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE raw_record, ingest_run CASCADE`);
  });
  afterAll(async () => {
    await db.execute(sql`TRUNCATE raw_record, ingest_run CASCADE`);
    await closeDb();
  });

  it("writes one raw_record per row with its hash, and a run with the counts", async () => {
    const { runId, counts } = await landReport("bamboo-employee-performance");

    expect(counts).toEqual({
      read: 69,
      inserted: 69,
      updated: 0,
      unchanged: 0,
      rejected: 0,
      deleted: 0,
    });
    const records = await db.select().from(rawRecord);
    expect(records).toHaveLength(69);
    expect(records[0]).toMatchObject({
      runId,
      sourceSystem: "bamboo_export",
      entity: "assessment",
    });
    expect(records.every((r) => /^[0-9a-f]{64}$/.test(r.payloadHash))).toBe(
      true,
    );
    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, runId));
    expect(run).toMatchObject({
      status: "succeeded",
      sourceSystem: "bamboo_export",
      adapter: "file",
      counts,
      params: { entity: "assessment", profile: "bamboo-employee-performance" },
    });
  });

  it("re-importing the same file creates no new raw_records", async () => {
    await landReport("bamboo-employee-performance");

    const again = await landReport("bamboo-employee-performance");

    expect(again.counts).toMatchObject({
      read: 69,
      inserted: 0,
      unchanged: 69,
      rejected: 0,
    });
    expect(await db.select().from(rawRecord)).toHaveLength(69);
    expect(await db.select().from(ingestRun)).toHaveLength(2);
  });

  it("counts rows the profile rejects, with the reason, and lands the rest", async () => {
    const { runId, counts } = await landReport("bamboo-goal-status");

    expect(counts).toMatchObject({
      read: 119,
      inserted: 117,
      rejected: 2,
    });
    expect(await db.select().from(rawRecord)).toHaveLength(117);
    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, runId));
    expect(run.status).toBe("succeeded");
    expect(run.rejects).toHaveLength(2);
    expect(run.rejects?.[0].reason).toContain('key column "Goal" is empty');
    // Stored structured too, for UIs that word it themselves.
    expect(run.rejects?.[0]).toMatchObject({
      code: "empty_key",
      column: "Goal",
    });
  });

  it("a run stopped midway ends in error, keeps what it landed, and says why", async () => {
    const profile = getBuiltinProfile("bamboo-employee-performance")!;
    const lake = await DuckDbFileLake.open(REPORTS);
    const controller = new AbortController();
    // The worker is told to terminate after the first batch of rows.
    const stopAfterFirstBatch: LakeAdapter = {
      listTables: () => lake.listTables(),
      describeTable: (table) => lake.describeTable(table),
      close: () => lake.close(),
      async *readBatches(table, opts) {
        for await (const batch of lake.readBatches(table, opts)) {
          yield batch;
          controller.abort(new Error("The upload worker was terminated"));
        }
      },
    };
    try {
      const error = await runIngest({
        adapter: new FileSourceAdapter(
          profile,
          stopAfterFirstBatch,
          undefined,
          {
            batchSize: 7,
          },
        ),
        entity: profile.entity,
        landing: true,
        db,
        extract: { signal: controller.signal },
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(IngestRunError);
      const [run] = await db
        .select()
        .from(ingestRun)
        .where(eq(ingestRun.id, (error as IngestRunError).runId));
      expect(run.status).toBe("error");
      expect(run.error).toContain("terminated");
      expect(run.finishedAt).toBeInstanceOf(Date);
      expect(run.counts).toMatchObject({ read: 7, inserted: 7 });
      expect(await db.select().from(rawRecord)).toHaveLength(7);
    } finally {
      await lake.close();
    }
  });

  it("is landing only: no domain row is written", async () => {
    // (Other specs may have left people in the shared DB: compare, not count.)
    const peopleBefore = await db.select().from(person);

    await landReport("bamboo-feedback-status");

    expect(await db.select().from(person)).toEqual(peopleBefore);
    expect(await db.select().from(rawRecord)).toHaveLength(220);
  });

  it("refuses a domain entity without landing mode instead of upserting garbage", async () => {
    const lake = await DuckDbFileLake.open(REPORTS);
    try {
      const profile = getBuiltinProfile("bamboo-goal-status")!;
      await expect(
        runIngest({
          adapter: new FileSourceAdapter(profile, lake),
          entity: "goal",
          db,
        }),
      ).rejects.toThrow(/landing/);
    } finally {
      await lake.close();
    }
    expect(await db.select().from(rawRecord)).toHaveLength(0);
  });
});
