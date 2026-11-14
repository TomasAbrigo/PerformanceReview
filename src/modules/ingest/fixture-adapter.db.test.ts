import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, db } from "@/db/client";
import { employment } from "@/db/schema";
import { FixtureAdapter } from "./fixture-adapter";
import { runIngest } from "./run-ingest";
import { resetDomainTables, seedFromFixtures } from "./seed";

// These seed a whole company: leave room on a slow or busy machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SMALL = path.resolve("fixtures/bamboo/small");

describe("a full employee run over a generated directory with a bad record", () => {
  let dir: string;

  beforeAll(async () => {
    await resetDomainTables(db);
    await seedFromFixtures({ size: "small", db });
    dir = await mkdtemp(path.join(tmpdir(), "fixture-bad-record-"));
    await cp(SMALL, dir, { recursive: true });
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await resetDomainTables(db);
    await closeDb();
  });

  it("rejects the record at staging and keeps the employee: nothing is soft-deleted", async () => {
    // The CEO's record has a name that is not text; its list item too.
    const getFile = path.join(dir, "employees/get/11.json");
    const body = JSON.parse(await readFile(getFile, "utf8"));
    body.firstName = { nested: true };
    await writeFile(getFile, JSON.stringify(body));
    const listFile = path.join(dir, "employees/list/page-001.json");
    const page = JSON.parse(await readFile(listFile, "utf8"));
    page.data.find(
      (e: { employeeId: string }) => e.employeeId === "11",
    ).lastName = [];
    await writeFile(listFile, JSON.stringify(page));

    const { counts } = await runIngest({
      adapter: new FixtureAdapter(dir),
      entity: "employee",
      db,
    });

    expect(counts).toMatchObject({ read: 40, rejected: 1, deleted: 0 });
    const live = await db
      .select({ id: employment.id })
      .from(employment)
      .where(and(eq(employment.sourceId, "11"), isNull(employment.deletedAt)));
    expect(live).toHaveLength(1);
  });
});
