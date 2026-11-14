import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  answer,
  cycleParticipant,
  importedQuestion,
  importedRequest,
  questionRevision,
  reviewCycle,
  reviewRequest,
  type ReviewCycle,
} from "@/db/schema";
import { jobsAsOf } from "@/modules/org-history/queries";
import type { Relationship } from "@/modules/templates/constants";
import { answerColumns, type QuestionColumn } from "./questions";

/** Imported cycles come from Bamboo's report exports, keyed by cycle name. */
export const SOURCE = "bamboo_export" as const;

/** An ISO date out of a report cell ("2023-12-01", or a timestamp). */
export function isoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/**
 * The imported cycle named `name`, created closed on first sight. `date`
 * widens its period when `widen` (assessment dates); feedback dates only
 * seed the period of a cycle that has no assessments.
 */
export async function upsertImportedCycle(
  tx: DbOrTx,
  input: { name: string; date: string; runId: string; widen: boolean },
  extra: { peer?: boolean } = {},
): Promise<ReviewCycle> {
  const [found] = await tx
    .select()
    .from(reviewCycle)
    .where(
      and(
        eq(reviewCycle.sourceSystem, SOURCE),
        eq(reviewCycle.sourceId, input.name),
      ),
    );
  if (!found) {
    const [created] = await tx
      .insert(reviewCycle)
      .values({
        name: input.name,
        periodStart: input.date,
        periodEnd: input.date,
        snapshotDate: input.date,
        status: "closed",
        components: {
          self: true,
          manager: true,
          peer: Boolean(extra.peer),
          upward: false,
          calibration: false,
        },
        anonymity: { peer: "transparent", upward: "transparent" },
        templateId: null,
        sourceSystem: SOURCE,
        sourceId: input.name,
        ingestRunId: input.runId,
      })
      .returning();
    return created;
  }
  const changes: Partial<ReviewCycle> = {};
  if (input.widen && input.date < found.periodStart) {
    changes.periodStart = input.date;
  }
  if (input.widen && input.date > found.periodEnd) {
    changes.periodEnd = input.date;
    changes.snapshotDate = input.date;
  }
  if (extra.peer && !found.components.peer) {
    changes.components = { ...found.components, peer: true };
  }
  if (Object.keys(changes).length === 0) return found;
  const [updated] = await tx
    .update(reviewCycle)
    .set({ ...changes, ingestRunId: input.runId })
    .where(eq(reviewCycle.id, found.id))
    .returning();
  return updated;
}

/**
 * The question revisions of an imported cycle for the report's question
 * columns, synthesized once per (cycle, column key). Returns column key ->
 * revision id.
 */
export async function ensureQuestions(
  tx: DbOrTx,
  cycleId: string,
  columns: QuestionColumn[],
): Promise<Map<string, string>> {
  const known = await tx
    .select()
    .from(importedQuestion)
    .where(eq(importedQuestion.cycleId, cycleId));
  const ids = new Map(known.map((k) => [k.columnKey, k.questionRevisionId]));
  for (const column of columns) {
    if (ids.has(column.key)) continue;
    const [revision] = await tx
      .insert(questionRevision)
      .values({
        cycleId,
        questionId: null,
        sectionTitle: column.sectionTitle,
        prompt: column.prompt,
        kind: column.kind,
        appliesTo: [column.relationship],
        visibleToReviewee: column.visibleToReviewee,
        required: false,
        scale: column.scale,
        choices: column.choices,
        sort: column.sort,
      })
      .returning({ id: questionRevision.id });
    await tx.insert(importedQuestion).values({
      cycleId,
      columnKey: column.key,
      questionRevisionId: revision.id,
    });
    ids.set(column.key, revision.id);
  }
  return ids;
}

/** The participant of `personId` in the cycle; created with its as-of snapshot. */
export async function ensureParticipant(
  tx: DbOrTx,
  cycle: ReviewCycle,
  personId: string,
): Promise<{
  id: string;
  snapManagerPersonId: string | null;
  created: boolean;
}> {
  const [found] = await tx
    .select()
    .from(cycleParticipant)
    .where(
      and(
        eq(cycleParticipant.cycleId, cycle.id),
        eq(cycleParticipant.revieweePersonId, personId),
      ),
    );
  if (found) return { ...found, created: false };
  const job = (await jobsAsOf(tx, [personId], cycle.snapshotDate)).get(
    personId,
  );
  const [created] = await tx
    .insert(cycleParticipant)
    .values({
      cycleId: cycle.id,
      revieweePersonId: personId,
      snapshotAsOf: cycle.snapshotDate,
      snapManagerPersonId: job?.managerPersonId ?? null,
      snapDepartment: job?.department ?? null,
      snapDivision: job?.division ?? null,
      snapJobTitle: job?.jobTitle ?? null,
      snapLocation: job?.location ?? null,
      snapJobHistoryId: job?.id ?? null,
    })
    .returning();
  return { ...created, created: true };
}

export type RequestInput = {
  cycleId: string;
  participantId: string;
  reviewerPersonId: string;
  relationship: Relationship;
  sourceId: string;
  hash: string;
  runId: string;
  submittedAt: Date | null;
  declinedAt: Date | null;
  csvReviewerName: string | null;
  reviewerMismatch: boolean;
};

/**
 * Upserts an imported request by its source id. `unchanged` when the source
 * record (its hash) is the same as last time: nothing is written.
 */
export async function upsertRequest(
  tx: DbOrTx,
  input: RequestInput,
): Promise<{ id: string; result: "inserted" | "updated" | "unchanged" }> {
  const [found] = await tx
    .select({ id: reviewRequest.id, hash: reviewRequest.payloadHash })
    .from(reviewRequest)
    .where(
      and(
        eq(reviewRequest.sourceSystem, SOURCE),
        eq(reviewRequest.sourceId, input.sourceId),
      ),
    );
  if (found && found.hash === input.hash) {
    return { id: found.id, result: "unchanged" };
  }
  const values = {
    cycleId: input.cycleId,
    participantId: input.participantId,
    reviewerPersonId: input.reviewerPersonId,
    relationship: input.relationship,
    status: input.submittedAt ? ("submitted" as const) : ("declined" as const),
    submittedAt: input.submittedAt,
    declinedAt: input.submittedAt ? null : input.declinedAt,
    sourceSystem: SOURCE,
    sourceId: input.sourceId,
    payloadHash: input.hash,
    ingestRunId: input.runId,
    reviewerMismatch: input.reviewerMismatch,
  };
  let id: string;
  if (found) {
    await tx
      .update(reviewRequest)
      .set(values)
      .where(eq(reviewRequest.id, found.id));
    id = found.id;
  } else {
    // The same review under another source id (a row re-keyed): take it over.
    const [row] = await tx
      .insert(reviewRequest)
      .values({ ...values, requestedAt: input.submittedAt ?? undefined })
      .onConflictDoUpdate({
        target: [
          reviewRequest.participantId,
          reviewRequest.relationship,
          reviewRequest.reviewerPersonId,
        ],
        set: values,
      })
      .returning({ id: reviewRequest.id });
    id = row.id;
  }
  await tx
    .insert(importedRequest)
    .values({
      requestId: id,
      csvReviewerName: input.csvReviewerName,
      reviewerMismatch: input.reviewerMismatch,
    })
    .onConflictDoUpdate({
      target: importedRequest.requestId,
      set: {
        csvReviewerName: input.csvReviewerName,
        reviewerMismatch: input.reviewerMismatch,
      },
    });
  return { id, result: found ? "updated" : "inserted" };
}

/**
 * Writes the answers of one side of a report row. Returns how many were
 * created (new) or rewritten, and the cells that the question cannot take.
 */
export async function saveAnswers(
  tx: DbOrTx,
  requestId: string,
  columns: QuestionColumn[],
  revisions: Map<string, string>,
  row: Record<string, unknown>,
): Promise<{ created: number; updated: number; invalid: string[] }> {
  const existing = await tx
    .select({ revisionId: answer.questionRevisionId })
    .from(answer)
    .where(
      and(
        eq(answer.requestId, requestId),
        inArray(answer.questionRevisionId, [...revisions.values()]),
      ),
    );
  const had = new Set(existing.map((a) => a.revisionId));
  let created = 0;
  let updated = 0;
  const invalid: string[] = [];
  for (const column of columns) {
    const revisionId = revisions.get(column.key)!;
    const values = answerColumns(column, row[column.header]);
    if (values === null) continue;
    if ("invalid" in values) {
      invalid.push(
        `Column "${column.header}": "${String(row[column.header])}" is not a valid answer`,
      );
      continue;
    }
    await tx
      .insert(answer)
      .values({ requestId, questionRevisionId: revisionId, ...values })
      .onConflictDoUpdate({
        target: [answer.requestId, answer.questionRevisionId],
        set: values,
      });
    if (had.has(revisionId)) updated++;
    else created++;
  }
  return { created, updated, invalid };
}

/** Counts the non-empty answer cells of one side (unchanged requests). */
export function answeredCells(
  columns: QuestionColumn[],
  row: Record<string, unknown>,
): number {
  return columns.filter((c) => {
    const v = answerColumns(c, row[c.header]);
    return v !== null && !("invalid" in v);
  }).length;
}
