/**
 * Test-only builders of review data (db tests). The app no longer runs the
 * review flow (#54): cycles, requests and answers arrive through the
 * historical import. These helpers write the same rows directly, so the
 * read side (visibility, dashboards, API, exports) can be tested on
 * native-looking cycles too.
 */
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  answer,
  cycleParticipant,
  finalRating,
  person,
  question,
  type QuestionRevision,
  questionRevision,
  ratingScaleOption,
  reviewCycle,
  type ReviewCycle,
  reviewRequest,
  reviewTemplate,
  templateSection,
} from "@/db/schema";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import { listTemplates, seedSystemTemplates } from "@/modules/templates";
import type { Relationship } from "@/modules/templates/constants";
import type { AnswerValue } from "./answers";
import { questionsFor } from "./answers";
import { snapshotGoalsForParticipants } from "./goal-snapshot";
import type { FinalRatingStage } from "./rating-constants";
import { snapshots } from "./service";
import type {
  CycleAnonymity,
  CycleComponents,
  CycleDueDates,
  CycleStatus,
} from "./status";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

/**
 * The fixture people. As of 2022-06-01 Bruno reports to Carla, Carla to Ana
 * and Ana to nobody; from 2023 Bruno reports to Ana.
 */
export const people = { ana: "", bruno: "", carla: "" };

export async function resetDb() {
  await db.execute(
    sql`TRUNCATE review_cycle, employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run CASCADE`,
  );
}

/** Seeds the system templates once; returns an enabled system template id. */
export async function systemTemplateId() {
  await seedSystemTemplates(db);
  return (await listTemplates(db)).find((t) => t.isSystem && t.enabled)!.id;
}

export const personIdOf = async (name: string) =>
  (
    await db
      .select({ id: person.id })
      .from(person)
      .where(eq(person.displayName, name))
  )[0].id;

/** Empties the tables, ingests the fixture people and their job history; fills `people`. */
export async function loadPeople() {
  await resetDb();
  const dir = await mkdtemp(path.join(tmpdir(), "review-core-"));
  await cp(FIXTURES, dir, { recursive: true });
  const adapter = new FixtureAdapter(dir);
  await runIngest({ adapter, entity: "employee", db });
  await runIngest({ adapter, entity: "job_history", db });
  await rm(dir, { recursive: true, force: true });
  people.ana = await personIdOf("Ana García");
  people.bruno = await personIdOf("Bruno Pérez");
  people.carla = await personIdOf("Carla Romero");
}

/** Copies a template's questions (and their scales) as the cycle's revisions. */
async function copyQuestions(cycleId: string, templateId: string) {
  const rows = await db
    .select({ section: templateSection, question })
    .from(question)
    .innerJoin(templateSection, eq(templateSection.id, question.sectionId))
    .innerJoin(
      reviewTemplate,
      eq(reviewTemplate.id, templateSection.templateId),
    )
    .where(
      and(
        eq(templateSection.templateId, templateId),
        isNull(reviewTemplate.deletedAt),
      ),
    )
    .orderBy(asc(templateSection.sort), asc(question.sort));
  if (rows.length === 0) return;
  const scaleIds = [
    ...new Set(rows.map((r) => r.question.scaleId).filter((v) => v !== null)),
  ];
  const options = scaleIds.length
    ? await db
        .select()
        .from(ratingScaleOption)
        .where(inArray(ratingScaleOption.scaleId, scaleIds))
        .orderBy(asc(ratingScaleOption.sort))
    : [];
  await db.insert(questionRevision).values(
    rows.map(({ section, question: q }, i) => ({
      cycleId,
      questionId: q.id,
      sectionTitle: section.title,
      prompt: q.prompt,
      kind: q.kind,
      appliesTo: q.appliesTo,
      visibleToReviewee: q.visibleToReviewee,
      required: q.required,
      choices: q.choices,
      role: q.role,
      yesNo: q.yesNo,
      scale: q.scaleId
        ? {
            options: options
              .filter((o) => o.scaleId === q.scaleId)
              .map((o) => ({
                value: o.value,
                label: o.label,
                normalized: o.normalized,
              })),
          }
        : null,
      sort: i,
    })),
  );
}

export type TestCycleInput = {
  name?: string;
  periodStart?: string;
  periodEnd?: string;
  snapshotDate?: string;
  status?: CycleStatus;
  components?: Partial<CycleComponents>;
  anonymity?: CycleAnonymity;
  dueDates?: CycleDueDates;
  templateId?: string | null;
  /** Reviewees, frozen with their org snapshot as of snapshotDate. */
  personIds: string[];
};

/**
 * A cycle as the review flow used to leave it: participants frozen as of the
 * snapshot date (org data and goals), the template's questions copied, and a
 * draft self and manager request per participant (the manager request goes
 * to the snapshot manager; flagged reviewer_missing without one).
 */
export async function createTestCycle(
  input: TestCycleInput,
): Promise<ReviewCycle> {
  const components: CycleComponents = {
    self: true,
    manager: true,
    peer: false,
    upward: false,
    calibration: false,
    ...input.components,
  };
  const [cycle] = await db
    .insert(reviewCycle)
    .values({
      name: input.name ?? "H1 2022",
      periodStart: input.periodStart ?? "2022-01-01",
      periodEnd: input.periodEnd ?? "2022-06-30",
      snapshotDate: input.snapshotDate ?? "2022-06-01",
      status: input.status ?? "collecting",
      components,
      anonymity: input.anonymity ?? {
        peer: "anonymous_to_employee",
        upward: "fully_anonymous",
      },
      templateId: input.templateId ?? null,
      dueDates: input.dueDates ?? {},
      launchedAt: new Date(),
    })
    .returning();
  if (input.templateId) await copyQuestions(cycle.id, input.templateId);
  if (input.personIds.length === 0) return cycle;
  const rows = await snapshots(
    db,
    cycle.id,
    input.personIds,
    cycle.snapshotDate,
  );
  const participants = await db
    .insert(cycleParticipant)
    .values(rows)
    .returning();
  await snapshotGoalsForParticipants(
    db,
    participants.map((p) => p.id),
  );
  const requests = participants.flatMap((p) => [
    ...(components.self
      ? [
          {
            cycleId: cycle.id,
            participantId: p.id,
            reviewerPersonId: p.revieweePersonId,
            relationship: "self" as const,
          },
        ]
      : []),
    ...(components.manager
      ? [
          {
            cycleId: cycle.id,
            participantId: p.id,
            reviewerPersonId: p.snapManagerPersonId,
            reviewerMissing: p.snapManagerPersonId === null,
            relationship: "manager" as const,
          },
        ]
      : []),
  ]);
  if (requests.length) await db.insert(reviewRequest).values(requests);
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

/** Id of a participant's request of `relationship` (and reviewer, if given). */
export async function requestIdOf(
  participantId: string,
  relationship: Relationship,
  reviewerPersonId?: string,
): Promise<string> {
  const [row] = await db
    .select({ id: reviewRequest.id })
    .from(reviewRequest)
    .where(
      and(
        eq(reviewRequest.participantId, participantId),
        eq(reviewRequest.relationship, relationship),
        reviewerPersonId
          ? eq(reviewRequest.reviewerPersonId, reviewerPersonId)
          : undefined,
      ),
    );
  return row.id;
}

/** Adds a (draft) request, e.g. peer or upward feedback. */
export async function addRequest(
  cycleId: string,
  participantId: string,
  relationship: Relationship,
  reviewerPersonId: string,
): Promise<string> {
  const [row] = await db
    .insert(reviewRequest)
    .values({ cycleId, participantId, relationship, reviewerPersonId })
    .returning({ id: reviewRequest.id });
  return row.id;
}

/** Default valid answer of a question (the first option / a text). */
export function defaultAnswer(q: QuestionRevision): AnswerValue {
  if (q.kind === "rating") return q.scale!.options[0].value;
  if (q.kind === "single_choice") return q.choices![0].value;
  return `Respuesta ${q.sort}`;
}

/** Columns of an answer row for a value of the question. */
function columns(q: QuestionRevision, value: AnswerValue) {
  const none = {
    optionValue: null,
    optionLabel: null,
    normalized: null,
    textValue: null,
  };
  if (q.kind === "rating") {
    const option = q.scale!.options.find((o) => o.value === Number(value))!;
    return {
      ...none,
      optionValue: option.value,
      optionLabel: option.label.es,
      normalized: option.normalized,
    };
  }
  if (q.kind === "single_choice")
    return { ...none, optionLabel: String(value) };
  return { ...none, textValue: String(value) };
}

/**
 * Writes the answers of a request (`pick` overrides the default answer of a
 * question; null leaves it empty) and, with `submit` (default), marks it
 * submitted. A submitted manager review appends its overall rating as a
 * `manager` final_rating row, like the review flow did.
 */
export async function answerRequest(
  requestId: string,
  pick: (q: QuestionRevision) => AnswerValue | undefined = () => undefined,
  { submit = true }: { submit?: boolean } = {},
) {
  const [request] = await db
    .select()
    .from(reviewRequest)
    .where(eq(reviewRequest.id, requestId));
  const [participant] = await db
    .select()
    .from(cycleParticipant)
    .where(eq(cycleParticipant.id, request.participantId));
  const questions = await questionsFor(
    db,
    request.cycleId,
    participant.templateGroupId,
    request.relationship,
  );
  for (const q of questions) {
    const picked = pick(q);
    const value = picked === undefined ? defaultAnswer(q) : picked;
    if (value === null) continue;
    const values = columns(q, value);
    await db
      .insert(answer)
      .values({ requestId, questionRevisionId: q.id, ...values })
      .onConflictDoUpdate({
        target: [answer.requestId, answer.questionRevisionId],
        set: values,
      });
  }
  if (!submit) return;
  await db
    .update(reviewRequest)
    .set({ status: "submitted", submittedAt: new Date() })
    .where(eq(reviewRequest.id, requestId));
  if (request.relationship !== "manager") return;
  const overall = questions.find((q) => q.role === "overall_rating");
  const value = overall ? pick(overall) : undefined;
  if (!overall || value === null) return;
  const cols = columns(overall, value ?? defaultAnswer(overall));
  await addRating(request.participantId, "manager", cols.optionValue!, {
    label: cols.optionLabel,
    normalized: cols.normalized,
    actorPersonId: request.reviewerPersonId,
  });
}

/** Appends a final_rating row. */
export async function addRating(
  participantId: string,
  stage: FinalRatingStage,
  value: number,
  extra: {
    label?: string | null;
    normalized?: number | null;
    actorPersonId?: string | null;
    reason?: string | null;
  } = {},
) {
  await db.insert(finalRating).values({
    participantId,
    stage,
    optionValue: value,
    optionLabel: extra.label ?? null,
    normalized: extra.normalized ?? null,
    actorPersonId: extra.actorPersonId ?? null,
    reason: extra.reason ?? null,
  });
}

export async function setStatus(cycleId: string, status: CycleStatus) {
  await db
    .update(reviewCycle)
    .set({ status })
    .where(eq(reviewCycle.id, cycleId));
}
