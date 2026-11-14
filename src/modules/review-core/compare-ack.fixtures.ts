import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  cycleParticipant,
  person,
  type QuestionRevision,
  questionRevision,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import { listTemplates, seedSystemTemplates } from "@/modules/templates";
import {
  type AnswerValue,
  createCycle,
  findManagerRequestId,
  findMySelfRequestId,
  getReview,
  launchCycle,
  saveDraft,
  shareReview,
  submit,
  transition,
  type CycleInput,
} from ".";

/**
 * Shared setup of the #15 db tests (compare, follow-up notes, acknowledgement,
 * history). As of 2022-06-01 Bruno reports to Carla, Carla to Ana and Ana to
 * nobody; from 2024 Bruno reports to Ana (a manager change after the cycle).
 */
const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

export const people = { ana: "", bruno: "", carla: "" };

export const hr: ActorContext = { personId: null, role: "hr" };
export const as = (
  personId: string,
  role: ActorContext["role"] = "employee",
): ActorContext => ({ personId, role });
/** Someone with no relation to Bruno's reviews. */
export const outsider = () => as(randomUUID());

export async function resetDb() {
  await db.execute(
    sql`TRUNCATE review_cycle, employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run CASCADE`,
  );
}

/** Seeds the system templates once; returns the template id to launch. */
export async function systemTemplateId() {
  await seedSystemTemplates(db);
  return (await listTemplates(db)).find((t) => t.isSystem && t.enabled)!.id;
}

/** Ingests the fixture people and their job history; fills `people`. */
export async function loadPeople() {
  await resetDb();
  const dir = await mkdtemp(path.join(tmpdir(), "compare-ack-"));
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
  people.ana = await idOf("Ana García");
  people.bruno = await idOf("Bruno Pérez");
  people.carla = await idOf("Carla Romero");
}

export function cycleInput(
  templateId: string,
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
      peer: false,
      upward: false,
      calibration: false,
    },
    anonymity: { peer: "anonymous_to_employee", upward: "fully_anonymous" },
    templateId,
    dueDates: { self: "2022-07-15", manager: "2022-07-30" },
    participantFilter: { kind: "people", personIds: [people.bruno] },
    ...overrides,
  };
}

/** A launched cycle in the collecting phase (self and manager requests). */
export async function collectingCycle(
  templateId: string,
  overrides: Partial<CycleInput> = {},
) {
  const cycle = await createCycle(db, cycleInput(templateId, overrides));
  const launched = await launchCycle(db, cycle.id, null);
  // Without peers there is no nominations phase: launching already collects.
  if (launched.status !== "collecting") {
    await transition(db, cycle.id, "collecting", null);
  }
  return cycle;
}

export const participantOf = async (cycleId: string, personId: string) =>
  (
    await db
      .select()
      .from(cycleParticipant)
      .where(
        and(
          eq(cycleParticipant.cycleId, cycleId),
          eq(cycleParticipant.revieweePersonId, personId),
        ),
      )
  )[0];

/** The revisions of a cycle (every relationship), in order. */
export const revisions = (cycleId: string) =>
  db
    .select()
    .from(questionRevision)
    .where(eq(questionRevision.cycleId, cycleId))
    .orderBy(questionRevision.sort);

/** Makes the cycle's revisions matching `pick` apply to both self and manager. */
export async function askBoth(
  cycleId: string,
  pick: (q: QuestionRevision) => boolean,
) {
  const matching = (await revisions(cycleId)).filter(pick);
  for (const q of matching) {
    await db
      .update(questionRevision)
      .set({ appliesTo: ["self", "manager"] })
      .where(eq(questionRevision.id, q.id));
  }
  return matching;
}

/** Default valid answer of a question (the first option / a text). */
export function defaultAnswer(q: QuestionRevision): AnswerValue {
  if (q.kind === "rating") return q.scale!.options[0].value;
  if (q.kind === "single_choice") return q.choices![0].value;
  return `Respuesta ${q.sort}`;
}

/** Fills every question of a request (with `pick` overrides) and submits. */
export async function fillAndSubmit(
  actor: ActorContext,
  requestId: string,
  pick: (q: QuestionRevision) => AnswerValue | undefined = () => undefined,
) {
  // `pick` returns undefined for "the default answer", null to leave it empty.
  const review = (await getReview(db, actor, requestId))!;
  await saveDraft(
    db,
    actor,
    requestId,
    review.questions.map((q) => {
      const picked = pick(q);
      return {
        questionRevisionId: q.id,
        value: picked === undefined ? defaultAnswer(q) : picked,
      };
    }),
  );
  await submit(db, actor, requestId);
}

export async function submitSelf(
  cycleId: string,
  pick?: (q: QuestionRevision) => AnswerValue | undefined,
) {
  const id = (await findMySelfRequestId(db, as(people.bruno), cycleId))!;
  await fillAndSubmit(as(people.bruno), id, pick);
  return id;
}

export async function submitManager(
  cycleId: string,
  pick?: (q: QuestionRevision) => AnswerValue | undefined,
) {
  const p = await participantOf(cycleId, people.bruno);
  const id = (await findManagerRequestId(db, as(people.carla), p.id))!;
  await fillAndSubmit(as(people.carla), id, pick);
  return { requestId: id, participantId: p.id };
}

/** Both reviews submitted and the manager review shared with Bruno. */
export async function sharedCycle(
  templateId: string,
  overrides: Partial<CycleInput> = {},
  pick?: {
    self?: (q: QuestionRevision) => AnswerValue | undefined;
    manager?: (q: QuestionRevision) => AnswerValue | undefined;
  },
) {
  const cycle = await collectingCycle(templateId, overrides);
  await submitSelf(cycle.id, pick?.self);
  const manager = await submitManager(cycle.id, pick?.manager);
  await shareReview(db, as(people.carla, "manager"), manager.requestId);
  return { cycle, ...manager };
}
