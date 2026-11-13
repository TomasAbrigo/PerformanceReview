import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { person } from "@/db/schema";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import {
  getJobHistory,
  jobAsOf,
  jobsAsOf,
  managerAsOf,
  orgTreeAsOf,
} from "./queries";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

let dir: string;
let ana: string;
let bruno: string;
let carla: string;

async function reset() {
  await db.execute(
    sql`TRUNCATE employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run CASCADE`,
  );
}

async function ingestAll() {
  const adapter = new FixtureAdapter(dir);
  await runIngest({ adapter, entity: "employee", db });
  await runIngest({ adapter, entity: "job_history", db });
  const id = async (name: string) =>
    (
      await db
        .select({ id: person.id })
        .from(person)
        .where(eq(person.displayName, name))
    )[0].id;
  [ana, bruno, carla] = await Promise.all([
    id("Ana García"),
    id("Bruno Pérez"),
    id("Carla Romero"),
  ]);
}

const shape = (nodes: Awaited<ReturnType<typeof orgTreeAsOf>>) =>
  nodes.map((n) => [n.displayName, n.depth, n.parentId]);

beforeEach(async () => {
  await reset();
  dir = await mkdtemp(path.join(tmpdir(), "org-"));
  await cp(FIXTURES, dir, { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
afterAll(async () => {
  await reset();
  await closeDb();
});

describe("managerAsOf", () => {
  beforeEach(ingestAll);

  it("returns the manager valid on the date, boundaries included", async () => {
    expect(await managerAsOf(db, bruno, "2021-07-14")).toBeNull();
    expect(await managerAsOf(db, bruno, "2021-07-15")).toBe(carla);
    expect(await managerAsOf(db, bruno, "2022-12-31")).toBe(carla);
    expect(await managerAsOf(db, bruno, "2023-01-01")).toBe(ana);
    expect(await managerAsOf(db, bruno, "2030-01-01")).toBe(ana);
  });

  it("returns null after the person's termination", async () => {
    expect(await managerAsOf(db, carla, "2024-06-30")).toBe(ana);
    expect(await managerAsOf(db, carla, "2024-07-01")).toBeNull();
  });

  it("returns null for someone without a manager", async () => {
    expect(await managerAsOf(db, ana, "2025-01-01")).toBeNull();
  });
});

describe("jobAsOf / getJobHistory", () => {
  beforeEach(ingestAll);

  it("jobsAsOf returns the rows valid on the date for many people at once", async () => {
    const jobs = await jobsAsOf(db, [ana, bruno, carla], "2025-01-01");
    expect(jobs.get(bruno)?.managerPersonId).toBe(ana);
    expect(jobs.get(ana)?.managerPersonId).toBeNull();
    expect(jobs.has(carla)).toBe(false);
    expect((await jobsAsOf(db, [], "2025-01-01")).size).toBe(0);
  });

  it("returns the job row valid on the date", async () => {
    expect(await jobAsOf(db, bruno, "2022-06-01")).toMatchObject({
      jobTitle: "Developer",
      validFrom: "2021-07-15",
      validTo: "2023-01-01",
    });
    expect(await jobAsOf(db, bruno, "2020-01-01")).toBeNull();
  });

  it("lists the history newest first with manager names", async () => {
    const rows = await getJobHistory(db, bruno);
    expect(
      rows.map((r) => [r.validFrom, r.jobTitle, r.managerName, r.managerRaw]),
    ).toEqual([
      ["2023-01-01", "Senior Developer", "Ana García", "Ana García"],
      ["2021-07-15", "Developer", "Carla Romero", "Carla Romero"],
    ]);
  });
});

describe("orgTreeAsOf", () => {
  it("shows the old hierarchy before a manager change and the new one after", async () => {
    await ingestAll();

    expect(shape(await orgTreeAsOf(db, "2022-06-01"))).toEqual([
      ["Ana García", 0, null],
      ["Carla Romero", 1, ana],
      ["Bruno Pérez", 2, carla],
    ]);
    expect(shape(await orgTreeAsOf(db, "2023-01-01"))).toEqual([
      ["Ana García", 0, null],
      ["Bruno Pérez", 1, ana],
      ["Carla Romero", 1, ana],
    ]);
    // Carla left on 2024-06-30.
    expect(shape(await orgTreeAsOf(db, "2025-01-01"))).toEqual([
      ["Ana García", 0, null],
      ["Bruno Pérez", 1, ana],
    ]);
    expect(await orgTreeAsOf(db, "2000-01-01")).toEqual([]);
  });

  it("keeps reports to a terminated manager as they were", async () => {
    // Bruno never moves: he keeps reporting to Carla after she leaves.
    const p = path.join(dir, "tables-jobInfo.json");
    const rows = JSON.parse(await readFile(p, "utf8")) as { id: unknown }[];
    await writeFile(
      p,
      JSON.stringify(rows.filter((r) => !["5", "6"].includes(String(r.id)))),
    );
    const page = path.join(dir, "employees-page-1.json");
    const body = JSON.parse(await readFile(page, "utf8")) as {
      data: { id: unknown; supervisorEId: unknown }[];
    };
    body.data.find((e) => String(e.id) === "102")!.supervisorEId = "103";
    await writeFile(page, JSON.stringify(body));
    await ingestAll();

    expect(await managerAsOf(db, bruno, "2025-01-01")).toBe(carla);
    // Carla is not in the 2025 org, so Bruno shows up as a root there.
    expect(shape(await orgTreeAsOf(db, "2025-01-01"))).toEqual([
      ["Ana García", 0, null],
      ["Bruno Pérez", 0, null],
    ]);
  });
});
