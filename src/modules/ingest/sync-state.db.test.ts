import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { employment, ingestRun, syncState } from "@/db/schema";
import { FixtureAdapter } from "./fixture-adapter";
import { IngestRunError, runIngest } from "./run-ingest";
import { advanceSyncState, getSyncState } from "./sync-state";
import type {
  Entity,
  ExtractContext,
  ExtractedRecord,
  SourceAdapter,
} from "./types";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

let dir: string;

async function reset() {
  await db.execute(
    sql`TRUNCATE source_identity, employment, person, raw_record, ingest_run, sync_state CASCADE`,
  );
}

/** Delegates to the fixtures but throws after `failAfter` records. */
class FlakyAdapter implements SourceAdapter {
  readonly source = "bamboo_api" as const;
  readonly name = "flaky";
  readonly entities = ["employee"] as const;
  readonly contexts: ExtractContext[] = [];
  private readonly inner = new FixtureAdapter(dir);

  constructor(private readonly failAfter: number) {}

  async *extract(
    ctx: ExtractContext,
    entity: Entity,
  ): AsyncIterable<ExtractedRecord> {
    this.contexts.push(ctx);
    let n = 0;
    for await (const record of this.inner.extract(ctx, entity)) {
      if (n++ === this.failAfter) throw new Error("connection reset");
      yield record;
    }
  }
}

/** Returns only the first `limit` fixture records. */
class FirstRecordsAdapter extends FixtureAdapter {
  constructor(private readonly limit: number) {
    super(dir);
  }

  async *extract(
    ctx: ExtractContext,
    entity: Entity,
  ): AsyncIterable<ExtractedRecord> {
    let n = 0;
    for await (const record of super.extract(ctx, entity)) {
      if (n++ < this.limit) yield record;
    }
  }
}

const run = (id: string) =>
  db
    .select()
    .from(ingestRun)
    .where(eq(ingestRun.id, id))
    .then(([r]) => r);

const state = () =>
  getSyncState(db, { sourceSystem: "bamboo_api", entity: "employee" });

describe("sync_state and run outcome", () => {
  beforeEach(async () => {
    await reset();
    dir = await mkdtemp(path.join(tmpdir(), "sync-state-"));
    await cp(FIXTURES, dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  afterAll(async () => {
    await reset();
    await closeDb();
  });

  it("a successful run sets the watermark, last_success_at and last_run_id", async () => {
    expect(await state()).toBeNull();

    const { runId } = await runIngest({
      adapter: new FixtureAdapter(dir),
      entity: "employee",
      db,
    });

    const finished = await run(runId);
    expect(finished.status).toBe("succeeded");
    expect(finished.finishedAt).toBeInstanceOf(Date);
    const after = await state();
    expect(after).toMatchObject({ lastRunId: runId, cursor: null });
    expect(after?.lastSuccessAt).toBeInstanceOf(Date);
    // The watermark is when the extraction started: whatever changes while a
    // run is in flight are picked up again by the next one.
    expect(after?.watermark).toBe(finished.startedAt?.toISOString());
  });

  it("keeps a single row per source and entity across runs", async () => {
    await runIngest({
      adapter: new FixtureAdapter(dir),
      entity: "employee",
      db,
    });
    const second = await runIngest({
      adapter: new FixtureAdapter(dir),
      entity: "employee",
      db,
    });

    const rows = await db.select().from(syncState);
    expect(rows).toHaveLength(1);
    expect(rows[0].lastRunId).toBe(second.runId);
  });

  it("a run that throws mid-batch ends in error and leaves the watermark alone", async () => {
    await runIngest({
      adapter: new FixtureAdapter(dir),
      entity: "employee",
      db,
    });
    const before = await state();
    expect(before?.watermark).toBeTruthy();

    const failure = await runIngest({
      adapter: new FlakyAdapter(2),
      entity: "employee",
      db,
    }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(IngestRunError);
    const { runId, message } = failure as IngestRunError;
    expect(message).toBe("connection reset");

    const failed = await run(runId);
    expect(failed.status).toBe("error");
    expect(failed.finishedAt).toBeInstanceOf(Date);
    expect(failed.error).toBe("connection reset");
    // Two records made it through before the failure.
    expect(failed.counts).toMatchObject({ read: 2, unchanged: 2 });
    expect(await state()).toEqual(before);
  });

  it("a failed first run does not create a sync_state row", async () => {
    await expect(
      runIngest({ adapter: new FlakyAdapter(1), entity: "employee", db }),
    ).rejects.toThrow("connection reset");

    expect(await state()).toBeNull();
    const [only] = await db.select().from(ingestRun);
    expect(only).toMatchObject({ status: "error" });
    expect(only.finishedAt).toBeInstanceOf(Date);
  });

  it("the next successful run advances the watermark after a failure", async () => {
    await runIngest({
      adapter: new FixtureAdapter(dir),
      entity: "employee",
      db,
    });
    const first = await state();
    await runIngest({
      adapter: new FlakyAdapter(0),
      entity: "employee",
      db,
    }).catch(() => undefined);

    const { runId } = await runIngest({
      adapter: new FixtureAdapter(dir),
      entity: "employee",
      db,
    });

    const after = await state();
    expect(after?.lastRunId).toBe(runId);
    expect(after!.watermark! > first!.watermark!).toBe(true);
  });

  it("hands `since` to the adapter and records it on the run", async () => {
    const adapter = new FlakyAdapter(99);

    const { runId } = await runIngest({
      adapter,
      entity: "employee",
      db,
      since: "2026-11-01T00:00:00.000Z",
    });

    expect(adapter.contexts).toEqual([{ since: "2026-11-01T00:00:00.000Z" }]);
    expect((await run(runId)).params).toMatchObject({
      entity: "employee",
      since: "2026-11-01T00:00:00.000Z",
    });
  });

  it("never soft-deletes on an incremental run (a partial extraction)", async () => {
    await runIngest({
      adapter: new FixtureAdapter(dir),
      entity: "employee",
      db,
    });

    // A source that only returns what changed: 2 of the 3 employees.
    const incremental = await runIngest({
      adapter: new FirstRecordsAdapter(2),
      entity: "employee",
      db,
      since: "2026-11-01T00:00:00.000Z",
    });

    expect(incremental.counts).toMatchObject({ read: 2, deleted: 0 });
    const live = await db
      .select()
      .from(employment)
      .where(sql`${employment.deletedAt} is null`);
    expect(live).toHaveLength(3);

    // The same two records as a full extraction mean the third is gone.
    const full = await runIngest({
      adapter: new FirstRecordsAdapter(2),
      entity: "employee",
      db,
    });
    expect(full.counts).toMatchObject({ read: 2, deleted: 1 });
  });
});

describe("advanceSyncState", () => {
  afterAll(async () => {
    await reset();
    await closeDb();
  });

  it("upserts by (source, entity)", async () => {
    await reset();
    const [a] = await db
      .insert(ingestRun)
      .values({ status: "succeeded" })
      .returning({ id: ingestRun.id });
    const [b] = await db
      .insert(ingestRun)
      .values({ status: "succeeded" })
      .returning({ id: ingestRun.id });
    const key = { sourceSystem: "bamboo_api", entity: "goal" } as const;

    await advanceSyncState(db, { ...key, watermark: "w1", runId: a.id });
    await advanceSyncState(db, {
      ...key,
      watermark: "w2",
      cursor: "page-9",
      runId: b.id,
    });

    expect(await getSyncState(db, key)).toMatchObject({
      watermark: "w2",
      cursor: "page-9",
      lastRunId: b.id,
    });
    expect(await db.select().from(syncState)).toHaveLength(1);
  });
});
