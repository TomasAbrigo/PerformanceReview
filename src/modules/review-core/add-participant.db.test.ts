import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, db } from "@/db/client";
import { cycleParticipant, person } from "@/db/schema";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import { listTemplates, seedSystemTemplates } from "@/modules/templates";
import * as requests from "./requests";
import { addParticipant, createCycle, launchCycle } from "./service";

vi.mock("./requests", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./requests")>();
  return { ...actual, ensureSelfRequests: vi.fn(actual.ensureSelfRequests) };
});

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");
const idOf = async (name: string) =>
  (
    await db
      .select({ id: person.id })
      .from(person)
      .where(eq(person.displayName, name))
  )[0].id;

async function reset() {
  await db.execute(
    sql`TRUNCATE review_cycle, employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run CASCADE`,
  );
}

beforeEach(async () => {
  await reset();
  await seedSystemTemplates(db);
  const dir = await mkdtemp(path.join(tmpdir(), "add-participant-"));
  await cp(FIXTURES, dir, { recursive: true });
  const adapter = new FixtureAdapter(dir);
  await runIngest({ adapter, entity: "employee", db });
  await runIngest({ adapter, entity: "job_history", db });
  await rm(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await reset();
  await closeDb();
});

describe("addParticipant", () => {
  it("adds nobody when creating the self request fails", async () => {
    const [ana, carla] = await Promise.all(
      ["Ana García", "Carla Romero"].map(idOf),
    );
    const templateId = (await listTemplates(db)).find(
      (t) => t.isSystem && t.enabled,
    )!.id;
    const cycle = await createCycle(db, {
      name: "Atomic",
      periodStart: "2022-01-01",
      periodEnd: "2022-06-30",
      snapshotDate: "2022-06-01",
      components: {
        self: true,
        manager: true,
        peer: false,
        upward: false,
        calibration: false,
      },
      anonymity: { peer: "anonymous_to_employee", upward: "fully_anonymous" },
      templateId,
      dueDates: {},
      participantFilter: { kind: "people", personIds: [ana] },
    });
    await launchCycle(db, cycle.id, null); // straight to collecting

    vi.mocked(requests.ensureSelfRequests).mockRejectedValueOnce(
      new Error("boom"),
    );
    await expect(
      addParticipant(db, cycle.id, carla, "2022-06-01"),
    ).rejects.toThrow("boom");
    const rows = await db
      .select()
      .from(cycleParticipant)
      .where(eq(cycleParticipant.revieweePersonId, carla));
    expect(rows).toHaveLength(0);
  });
});
