import { and, asc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  historyImportRow,
  importedRequest,
  ingestRun,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";

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
  cycles: HistoryCycleResult[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sum = (column: typeof historyImportRow.participantsCreated) =>
  sql<number>`coalesce(sum(${column}), 0)::int`;

/** What a historical import run did, per detected cycle; null if it imported none. */
export async function getHistoryImportResult(
  db: DbOrTx,
  runId: string,
): Promise<HistoryImportResult | null> {
  if (!UUID.test(runId)) return null;
  const [run] = await db
    .select({ id: ingestRun.id, entity: ingestRun.entity })
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
  if (rows.length === 0) return null;

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
        sql`${reviewRequest.cycleId} in ${rows.map((r) => r.cycleId)}`,
      ),
    )
    .groupBy(reviewRequest.cycleId);
  const mismatches = new Map(flagged.map((f) => [f.cycleId, f.count]));
  return {
    runId: run.id,
    entity: run.entity,
    cycles: rows.map((r) => ({
      ...r,
      mismatches: mismatches.get(r.cycleId) ?? 0,
    })),
  };
}
