import { and, type AnyColumn, asc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { isUuid } from "@/lib/uuid";
import {
  historyImportRow,
  importedRequest,
  ingestRun,
  reviewCycle,
  reviewRequest,
  type IngestRunStatus,
} from "@/db/schema";
import {
  analysisTextSql,
  analyzableSql,
} from "@/modules/qualitative-analysis/analysis-text";
import { decisionOf, type CycleDecision } from "./decision";

export type HistoryCycleResult = {
  cycleId: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  /** Report rows of this cycle the run read (repeated rows included). */
  rows: number;
  /** Rows written or confirmed (inserted, updated, unchanged): #132. */
  written: number;
  /** Rows that lost to a later one of the same person and cycle (#132). */
  superseded: number;
  participantsCreated: number;
  requestsCreated: number;
  requestsUpdated: number;
  requestsUnchanged: number;
  /** Requests dropped: their side, or their row, left the file (#132). */
  requestsRemoved: number;
  answersCreated: number;
  answersUpdated: number;
  answersUnchanged: number;
  /** Answers dropped: their cell was emptied in the file (#132). */
  answersRemoved: number;
  /** Rows sent to (or kept in) the identity queue: retained, not written. */
  issues: number;
  /** Imported manager reviews of the cycle flagged reviewer_mismatch. */
  mismatches: number;
  /**
   * Open texts of the cycle that no label reads yet (new, or changed by the
   * import): what `pnpm analysis:run` would label next (#132).
   */
  pendingLabels: number;
};

export type HistoryImportResult = {
  runId: string;
  entity: string;
  status: IngestRunStatus;
  cycles: HistoryCycleResult[];
  /** What a `needs_decision` run asks (or asked: `resolved`), if anything. */
  decision: Omit<CycleDecision, "pending"> | null;
};

const sum = (column: AnyColumn) =>
  sql<number>`coalesce(sum(${column}), 0)::int`;

/**
 * What a historical import run did, per detected cycle; null if it imported
 * none and asks nothing (a run waiting for a decision may have no rows yet).
 */
export async function getHistoryImportResult(
  db: DbOrTx,
  runId: string,
): Promise<HistoryImportResult | null> {
  if (!isUuid(runId)) return null;
  const [run] = await db
    .select({
      id: ingestRun.id,
      entity: ingestRun.entity,
      status: ingestRun.status,
      params: ingestRun.params,
    })
    .from(ingestRun)
    .where(eq(ingestRun.id, runId));
  if (!run) return null;
  const rows = await db
    .select({
      cycleId: reviewCycle.id,
      name: reviewCycle.name,
      localizedName: reviewCycle.localizedName,
      periodStart: reviewCycle.periodStart,
      periodEnd: reviewCycle.periodEnd,
      rows: sql<number>`((count(*) filter (where ${historyImportRow.result} <> 'removed')) + coalesce(sum(${historyImportRow.duplicates}), 0))::int`,
      written: sql<number>`(count(*) filter (where ${historyImportRow.result} in ('inserted', 'updated', 'unchanged')))::int`,
      superseded: sql<number>`((count(*) filter (where ${historyImportRow.result} = 'superseded')) + coalesce(sum(${historyImportRow.duplicates}), 0))::int`,
      participantsCreated: sum(historyImportRow.participantsCreated),
      requestsCreated: sum(historyImportRow.requestsCreated),
      requestsUpdated: sum(historyImportRow.requestsUpdated),
      requestsUnchanged: sum(historyImportRow.requestsUnchanged),
      requestsRemoved: sum(historyImportRow.requestsRemoved),
      answersCreated: sum(historyImportRow.answersCreated),
      answersUpdated: sum(historyImportRow.answersUpdated),
      answersUnchanged: sum(historyImportRow.answersUnchanged),
      answersRemoved: sum(historyImportRow.answersRemoved),
      issues: sql<number>`(count(*) filter (where ${historyImportRow.result} in ('issues', 'ignored')))::int`,
    })
    .from(historyImportRow)
    .innerJoin(reviewCycle, eq(reviewCycle.id, historyImportRow.cycleId))
    .where(eq(historyImportRow.runId, runId))
    .groupBy(reviewCycle.id)
    .orderBy(asc(reviewCycle.periodEnd), asc(reviewCycle.name));
  const stored = decisionOf(run.params);
  const decision = stored ? withoutPending(stored) : null;
  if (rows.length === 0 && !decision) return null;

  const flagged = await db
    .select({
      cycleId: reviewRequest.cycleId,
      count: sql<number>`count(*)::int`,
    })
    .from(importedRequest)
    .innerJoin(reviewRequest, eq(reviewRequest.id, importedRequest.requestId))
    .where(
      and(
        eq(importedRequest.reviewerMismatch, true),
        rows.length > 0
          ? sql`${reviewRequest.cycleId} in ${rows.map((r) => r.cycleId)}`
          : sql`false`,
      ),
    )
    .groupBy(reviewRequest.cycleId);
  const mismatches = new Map(flagged.map((f) => [f.cycleId, f.count]));
  const pending =
    rows.length > 0
      ? await db.execute<{ cycle_id: string; n: number }>(sql`
          select r.cycle_id, count(*)::int as n
          from answer a
          join review_request r on r.id = a.request_id
          join cycle_participant cp on cp.id = r.participant_id
            and cp.removed_at is null
          join question_revision q on q.id = a.question_revision_id
          where r.cycle_id in ${rows.map((r) => r.cycleId)}
            and r.deleted_at is null and r.status = 'submitted'
            and ${analyzableSql()}
            and not exists (
              select 1 from qualitative_analysis x
              where x.answer_id = a.id
                and x.source_md5 = md5(${analysisTextSql()})
            )
            and not exists (
              select 1 from analysis_correction c
              where c.answer_id = a.id
                and (c.source_md5 is null
                     or c.source_md5 = md5(${analysisTextSql()}))
            )
          group by r.cycle_id`)
      : [];
  const pendingOf = new Map(pending.map((p) => [p.cycle_id, p.n]));
  return {
    runId: run.id,
    entity: run.entity,
    status: run.status,
    decision,
    cycles: rows.map((r) => ({
      ...r,
      mismatches: mismatches.get(r.cycleId) ?? 0,
      pendingLabels: pendingOf.get(r.cycleId) ?? 0,
    })),
  };
}

/** The rows a decision lists are for resuming only, not for the page. */
function withoutPending(
  decision: CycleDecision,
): Omit<CycleDecision, "pending"> {
  const rest: Partial<CycleDecision> = { ...decision };
  delete rest.pending;
  return rest as Omit<CycleDecision, "pending">;
}
