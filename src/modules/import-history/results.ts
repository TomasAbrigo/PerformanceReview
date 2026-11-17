import { and, type AnyColumn, asc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  historyImportRow,
  importedRequest,
  ingestRun,
  reviewCycle,
  reviewRequest,
  type IngestRunStatus,
} from "@/db/schema";
import { decisionOf, type CycleDecision } from "./decision";

export type HistoryCycleResult = {
  cycleId: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  /** Report rows of this cycle the run read. */
  rows: number;
  participantsCreated: number;
  requestsCreated: number;
  requestsUnchanged: number;
  answersCreated: number;
  answersUnchanged: number;
  /** Rows sent to (or kept in) the identity queue. */
  issues: number;
  /** Imported manager reviews of the cycle flagged reviewer_mismatch. */
  mismatches: number;
};

export type HistoryImportResult = {
  runId: string;
  entity: string;
  status: IngestRunStatus;
  cycles: HistoryCycleResult[];
  /** What a `needs_decision` run asks (or asked: `resolved`), if anything. */
  decision: Omit<CycleDecision, "pending"> | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!UUID.test(runId)) return null;
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
      periodStart: reviewCycle.periodStart,
      periodEnd: reviewCycle.periodEnd,
      rows: sql<number>`count(*)::int`,
      participantsCreated: sum(historyImportRow.participantsCreated),
      requestsCreated: sum(historyImportRow.requestsCreated),
      requestsUnchanged: sum(historyImportRow.requestsUnchanged),
      answersCreated: sum(historyImportRow.answersCreated),
      answersUnchanged: sum(historyImportRow.answersUnchanged),
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
  return {
    runId: run.id,
    entity: run.entity,
    status: run.status,
    decision,
    cycles: rows.map((r) => ({
      ...r,
      mismatches: mismatches.get(r.cycleId) ?? 0,
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
