import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { employment, person } from "@/db/schema";
import { listActiveEmployeeIds } from "./employment";

async function reset() {
  await db.execute(
    sql`TRUNCATE source_identity, employment, person, raw_record, ingest_run CASCADE`,
  );
}

type Period = {
  sourceId: string;
  hireDate: string | null;
  terminationDate?: string | null;
  status?: string | null;
  deleted?: boolean;
};

/** One person with the given employment periods (Bamboo ids are strings). */
async function personWith(name: string, periods: Period[]) {
  const [p] = await db
    .insert(person)
    .values({ displayName: name })
    .returning({ id: person.id });
  await db.insert(employment).values(
    periods.map((e) => ({
      personId: p.id,
      sourceSystem: "bamboo_api" as const,
      sourceId: e.sourceId,
      hireDate: e.hireDate,
      terminationDate: e.terminationDate ?? null,
      status: e.status ?? null,
      deletedAt: e.deleted ? new Date() : null,
    })),
  );
}

const daysFromToday = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe("listActiveEmployeeIds", () => {
  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await closeDb();
  });

  it("returns the Bamboo id of each person's current employment, when they are employed today", async () => {
    await personWith("Active", [{ sourceId: "201", hireDate: "2020-01-01" }]);
    await personWith("Rehired under a new id", [
      {
        sourceId: "202",
        hireDate: "2018-03-01",
        terminationDate: "2020-06-30",
      },
      { sourceId: "203", hireDate: "2022-01-10" },
    ]);
    await personWith("Terminated", [
      {
        sourceId: "204",
        hireDate: "2019-01-01",
        terminationDate: "2023-01-01",
      },
    ]);
    await personWith("Leaves soon", [
      {
        sourceId: "205",
        hireDate: "2021-01-01",
        terminationDate: daysFromToday(30),
      },
    ]);
    await personWith("Deleted at source", [
      { sourceId: "206", hireDate: "2021-01-01", deleted: true },
    ]);
    await personWith("Inactive", [
      { sourceId: "207", hireDate: "2021-01-01", status: "Inactive" },
    ]);

    expect(await listActiveEmployeeIds(db, "bamboo_api")).toEqual([
      "201",
      "203",
      "205",
    ]);
  });

  it("goes by the latest hire date: an older open period does not make a terminated person active", async () => {
    await personWith("Contradictory history", [
      { sourceId: "301", hireDate: "2019-01-01" },
      {
        sourceId: "302",
        hireDate: "2023-01-01",
        terminationDate: "2024-01-01",
      },
    ]);

    expect(await listActiveEmployeeIds(db, "bamboo_api")).toEqual([]);
  });

  it("only returns ids of the requested source", async () => {
    await personWith("Active", [{ sourceId: "201", hireDate: "2020-01-01" }]);

    expect(await listActiveEmployeeIds(db, "bamboo_export")).toEqual([]);
  });
});
