import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { person } from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import {
  createCycle,
  launchCycle,
  transition,
  type CycleInput,
} from "@/modules/review-core";
import { listTemplates, seedSystemTemplates } from "@/modules/templates";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

export const hr: ActorContext = { personId: null, role: "hr" };
export const as = (
  personId: string,
  role: ActorContext["role"] = "employee",
): ActorContext => ({ personId, role });

/** Wipes everything the notification tests touch. */
export async function resetAll() {
  await db.execute(
    sql`TRUNCATE notification, review_cycle, employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run CASCADE`,
  );
}

/** Ingests the three fixture people: Ana (CEO), Carla (reports to Ana), Bruno (to Carla in 2022). */
export async function seedPeople() {
  const dir = await mkdtemp(path.join(tmpdir(), "notifications-"));
  await cp(FIXTURES, dir, { recursive: true });
  const adapter = new FixtureAdapter(dir);
  await runIngest({ adapter, entity: "employee", db });
  await runIngest({ adapter, entity: "job_history", db });
  await rm(dir, { recursive: true, force: true });
  const idOf = async (name: string) =>
    (
      await db
        .select({ id: person.id })
        .from(person)
        .where(eq(person.displayName, name))
    )[0].id;
  const [ana, bruno, carla] = await Promise.all(
    ["Ana García", "Bruno Pérez", "Carla Romero"].map(idOf),
  );
  await seedSystemTemplates(db);
  const templateId = (await listTemplates(db)).find(
    (t) => t.isSystem && t.enabled,
  )!.id;
  return { ana, bruno, carla, templateId };
}

export type Seed = Awaited<ReturnType<typeof seedPeople>>;

/** A cycle input for `personIds` with the due dates given (self by default). */
export function cycleInput(
  seed: Seed,
  personIds: string[],
  overrides: Partial<CycleInput> = {},
): CycleInput {
  return {
    name: "H1 2022",
    periodStart: "2022-01-01",
    periodEnd: "2022-06-30",
    snapshotDate: "2022-06-01",
    components: {
      self: true,
      manager: true,
      peer: true,
      upward: false,
      calibration: false,
    },
    anonymity: { peer: "anonymous_to_employee", upward: "fully_anonymous" },
    templateId: seed.templateId,
    dueDates: { self: "2022-07-15" },
    participantFilter: { kind: "people", personIds },
    ...overrides,
  };
}

/** A launched cycle in `collecting` (self requests created). */
export async function collectingCycle(
  seed: Seed,
  personIds: string[],
  overrides: Partial<CycleInput> = {},
) {
  const cycle = await createCycle(db, cycleInput(seed, personIds, overrides));
  await launchCycle(db, cycle.id, null);
  await transition(db, cycle.id, "collecting", null);
  return cycle;
}
