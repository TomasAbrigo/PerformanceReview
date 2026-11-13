import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import { getPerson, listPeople } from "./queries";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

describe("people queries", () => {
  beforeAll(async () => {
    await db.execute(
      sql`TRUNCATE source_identity, employment, person, raw_record, ingest_run CASCADE`,
    );
    await runIngest({
      adapter: new FixtureAdapter(FIXTURES),
      entity: "employee",
      db,
    });
  });
  afterAll(async () => {
    await closeDb();
  });

  it("lists everyone sorted by name with their current status", async () => {
    const people = await listPeople(db);
    expect(people.map((p) => [p.displayName, p.status])).toEqual([
      ["Ana García", "Active"],
      ["Bruno Pérez", "Active"],
      ["Carla Romero", "Inactive"],
    ]);
  });

  it("searches by name or email, case-insensitively", async () => {
    expect((await listPeople(db, "CARLA")).map((p) => p.displayName)).toEqual([
      "Carla Romero",
    ]);
    expect(
      (await listPeople(db, "bruno.perez@")).map((p) => p.displayName),
    ).toEqual(["Bruno Pérez"]);
    expect(await listPeople(db, "%")).toEqual([]);
  });

  it("returns a person's identities and employment periods", async () => {
    const [carla] = await listPeople(db, "carla");
    const detail = await getPerson(db, carla.id);

    expect(detail?.identities.map((i) => [i.kind, i.value])).toEqual(
      expect.arrayContaining([
        ["bamboo_id", "103"],
        ["employee_number", "0003"],
        ["work_email", "carla.romero@example.com"],
      ]),
    );
    expect(detail?.employments).toEqual([
      expect.objectContaining({
        hireDate: null,
        terminationDate: "2024-06-30",
      }),
    ]);
    expect(await getPerson(db, "not-a-uuid")).toBeNull();
  });

  it("excludes people whose employments are all soft-deleted", async () => {
    await db.execute(
      sql`UPDATE employment SET deleted_at = now() WHERE source_id = '103'`,
    );
    expect((await listPeople(db)).map((p) => p.displayName)).toEqual([
      "Ana García",
      "Bruno Pérez",
    ]);
  });
});
