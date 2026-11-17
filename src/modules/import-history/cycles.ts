import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  answer,
  answerQualityIssue,
  cycleParticipant,
  importedQuestion,
  importedRequest,
  questionRevision,
  reviewCycle,
  reviewRequest,
  type ReviewCycle,
} from "@/db/schema";
import type { LikertOverrides } from "@/modules/likert";
import { loadLikertOverrides } from "@/modules/likert/store";
import { snapshots } from "@/modules/review-core/service";
import type { Relationship } from "@/modules/templates/constants";
import { answerColumns, type QuestionColumn } from "./questions";
import { snapshotDateFor } from "./semester";

/** Imported cycles come from Bamboo's report exports, keyed by cycle name. */
export const SOURCE = "bamboo_export" as const;

/**
 * The imported cycle named `name`, created closed on first sight. `date`
 * widens its period when `widen` (assessment dates); feedback dates only
 * seed the period of a cycle that has no assessments.
 */
export async function upsertImportedCycle(
  tx: DbOrTx,
  input: { name: string; date: string; runId: string; widen: boolean },
  extra: { peer?: boolean } = {},
  /** Per-run cache (HandlerContext.cache): one lookup per cycle per run. */
  cache: Map<string, unknown> = new Map(),
): Promise<ReviewCycle> {
  const key = `cycle:${input.name}`;
  const cycle = await findOrCreateCycle(tx, input, extra, cache.get(key));
  cache.set(key, cycle);
  return cycle;
}

async function findOrCreateCycle(
  tx: DbOrTx,
  input: { name: string; date: string; runId: string; widen: boolean },
  extra: { peer?: boolean },
  cached: unknown,
): Promise<ReviewCycle> {
  const found =
    (cached as ReviewCycle | undefined) ??
    (
      await tx
        .select()
        .from(reviewCycle)
        .where(
          and(
            eq(reviewCycle.sourceSystem, SOURCE),
            eq(reviewCycle.sourceId, input.name),
          ),
        )
    )[0];
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
  }
  if (input.widen && input.date > found.snapshotDate) {
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
 * A closed imported cycle with a known period (a semester proposed to the
 * person resolving a `needs_decision` run); the existing one if the name was
 * imported already.
 */
export async function createImportedCycle(
  tx: DbOrTx,
  input: {
    name: string;
    periodStart: string;
    periodEnd: string;
    runId: string;
  },
): Promise<ReviewCycle> {
  const cycle = await findOrCreateCycle(
    tx,
    {
      name: input.name,
      date: input.periodEnd,
      runId: input.runId,
      widen: false,
    },
    {},
    undefined,
  );
  if (
    cycle.ingestRunId !== input.runId ||
    cycle.periodStart === input.periodStart
  ) {
    return cycle;
  }
  const [updated] = await tx
    .update(reviewCycle)
    .set({
      periodStart: input.periodStart,
      snapshotDate: snapshotDateFor(input.periodEnd),
    })
    .where(eq(reviewCycle.id, cycle.id))
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
  cache: Map<string, unknown> = new Map(),
): Promise<Map<string, string>> {
  const key = `questions:${cycleId}`;
  let ids = cache.get(key) as Map<string, string> | undefined;
  if (!ids) {
    const known = await tx
      .select()
      .from(importedQuestion)
      .where(eq(importedQuestion.cycleId, cycleId));
    ids = new Map(known.map((k) => [k.columnKey, k.questionRevisionId]));
    cache.set(key, ids);
    // Revisions imported before roles/dimensions existed get them now.
    for (const column of columns) {
      const id = ids.get(column.key);
      if (!id || (!column.role && !column.dimension)) continue;
      await tx
        .update(questionRevision)
        .set({ role: column.role, dimension: column.dimension })
        .where(
          and(
            eq(questionRevision.id, id),
            isNull(questionRevision.role),
            isNull(questionRevision.dimension),
          ),
        );
    }
  }
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
        role: column.role,
        dimension: column.dimension,
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
  // Same snapshot as a launched cycle (review-core), as of the period end.
  const [values] = await snapshots(
    tx,
    cycle.id,
    [personId],
    cycle.snapshotDate,
  );
  const [created] = await tx
    .insert(cycleParticipant)
    .values(values)
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
  /** Answered but never completed (no completion date): a draft. */
  draft?: boolean;
};

/**
 * Upserts an imported request by its source id. `unchanged` when the source
 * record (its hash) is the same as last time: nothing is written.
 *
 * A cycle has one request per (participant, relationship, reviewer), as in a
 * native cycle. When a report has two assessments of one person in one cycle
 * (two Assessment Dates), the LATEST one is that request: an older row finds
 * the newer one in place and is `superseded` (nothing written), a newer row
 * takes the request over (its source id and answers). The outcome depends on
 * the dates only, so re-imports are stable whatever the row order.
 */
export async function upsertRequest(
  tx: DbOrTx,
  input: RequestInput,
): Promise<{
  id: string;
  result: "inserted" | "updated" | "unchanged" | "superseded";
}> {
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
    status: input.draft
      ? ("draft" as const)
      : input.submittedAt
        ? ("submitted" as const)
        : ("declined" as const),
    submittedAt: input.submittedAt,
    declinedAt: input.submittedAt || input.draft ? null : input.declinedAt,
    sourceSystem: SOURCE,
    sourceId: input.sourceId,
    payloadHash: input.hash,
    ingestRunId: input.runId,
    reviewerMismatch: input.reviewerMismatch,
  };
  let id: string;
  let result: "inserted" | "updated" = found ? "updated" : "inserted";
  if (found) {
    await tx
      .update(reviewRequest)
      .set(values)
      .where(eq(reviewRequest.id, found.id));
    id = found.id;
  } else {
    const [same] = await tx
      .select({
        id: reviewRequest.id,
        submittedAt: reviewRequest.submittedAt,
        declinedAt: reviewRequest.declinedAt,
      })
      .from(reviewRequest)
      .where(
        and(
          eq(reviewRequest.participantId, input.participantId),
          eq(reviewRequest.relationship, input.relationship),
          eq(reviewRequest.reviewerPersonId, input.reviewerPersonId),
        ),
      );
    if (same) {
      const theirs = (same.submittedAt ?? same.declinedAt)?.getTime() ?? 0;
      const ours = (input.submittedAt ?? input.declinedAt)?.getTime() ?? 0;
      if (theirs >= ours) return { id: same.id, result: "superseded" };
      await tx
        .update(reviewRequest)
        .set(values)
        .where(eq(reviewRequest.id, same.id));
      id = same.id;
      result = "updated";
    } else {
      const [row] = await tx
        .insert(reviewRequest)
        .values({ ...values, requestedAt: input.submittedAt ?? undefined })
        .returning({ id: reviewRequest.id });
      id = row.id;
    }
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
  return { id, result };
}

/** The likert_mapping table as overrides, read once per run. */
export async function likertOverridesOf(
  tx: DbOrTx,
  cache: Map<string, unknown>,
): Promise<LikertOverrides> {
  let overrides = cache.get("likertOverrides") as LikertOverrides | undefined;
  if (!overrides) {
    overrides = await loadLikertOverrides(tx);
    cache.set("likertOverrides", overrides);
  }
  return overrides;
}

/**
 * Writes the answers of one side of a report row. Returns how many were
 * created (new) or rewritten, and the cells that the question cannot take.
 * A Likert option without equivalence is stored (raw value as label, no
 * value) and recorded in answer_quality_issue; a later import that maps it
 * resolves the issue.
 */
export async function saveAnswers(
  tx: DbOrTx,
  requestId: string,
  columns: QuestionColumn[],
  revisions: Map<string, string>,
  row: Record<string, unknown>,
  context: { cycleId: string; runId: string; overrides?: LikertOverrides },
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
  // Revisions of this request with an open quality issue: only those can be
  // resolved by this write (one lookup per request).
  const open = new Set(
    (
      await tx
        .select({ revisionId: answerQualityIssue.questionRevisionId })
        .from(answerQualityIssue)
        .where(
          and(
            eq(answerQualityIssue.requestId, requestId),
            isNull(answerQualityIssue.resolvedAt),
          ),
        )
    ).map((r) => r.revisionId),
  );
  const flag = async (
    column: QuestionColumn,
    revisionId: string,
    raw: string,
    reason: "unmapped_option" | "invalid_value",
    answerId: string | null,
  ) => {
    const issue = {
      answerId,
      cycleId: context.cycleId,
      columnKey: column.key,
      rawValue: raw,
      reason,
      runId: context.runId,
      resolvedAt: null,
    };
    await tx
      .insert(answerQualityIssue)
      .values({ requestId, questionRevisionId: revisionId, ...issue })
      .onConflictDoUpdate({
        target: [
          answerQualityIssue.requestId,
          answerQualityIssue.questionRevisionId,
        ],
        set: issue,
      });
  };
  const resolved: string[] = [];
  let created = 0;
  let updated = 0;
  const invalid: string[] = [];
  for (const column of columns) {
    const revisionId = revisions.get(column.key)!;
    const cell = answerColumns(column, row[column.header], context.overrides);
    if (cell === null) continue;
    if ("invalid" in cell) {
      // Rejected (the row reports it) and kept as a quality issue too.
      invalid.push(
        `Column "${column.header}": "${String(row[column.header])}" is not a valid answer`,
      );
      await flag(
        column,
        revisionId,
        String(row[column.header]).trim(),
        "invalid_value",
        null,
      );
      continue;
    }
    const values =
      "unmapped" in cell
        ? {
            optionValue: null,
            optionLabel: cell.raw,
            normalized: null,
            textValue: null,
          }
        : cell;
    const [saved] = await tx
      .insert(answer)
      .values({ requestId, questionRevisionId: revisionId, ...values })
      .onConflictDoUpdate({
        target: [answer.requestId, answer.questionRevisionId],
        set: values,
      })
      .returning({ id: answer.id });
    if ("unmapped" in cell) {
      await flag(column, revisionId, cell.raw, "unmapped_option", saved.id);
    } else if (open.has(revisionId)) {
      resolved.push(revisionId);
    }
    if (had.has(revisionId)) updated++;
    else created++;
  }
  if (resolved.length) {
    await tx
      .update(answerQualityIssue)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          eq(answerQualityIssue.requestId, requestId),
          inArray(answerQualityIssue.questionRevisionId, resolved),
          isNull(answerQualityIssue.resolvedAt),
        ),
      );
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
    // An unmapped Likert option is stored too (and flagged), so it counts.
    return v !== null && !("invalid" in v);
  }).length;
}
