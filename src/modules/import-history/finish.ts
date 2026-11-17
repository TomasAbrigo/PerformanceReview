import { aliasedTable, and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  historyImportRow,
  importedRequest,
  person,
  reviewCycle,
  reviewRequest,
  type IngestReject,
} from "@/db/schema";
import { snapshotGoalsForParticipants } from "@/modules/review-core/goal-snapshot";
import { snapshots } from "@/modules/review-core/service";
import { semesterConfig, snapToSemester } from "./semester";

/**
 * After a run, for each cycle it touched: rows are processed one by one and
 * each widens the cycle's period (min/max of the assessment dates, snapshot =
 * period end), so only now is the period final. Every participant's snapshot
 * is (re)computed as of it, and manager requests whose reviewer (the CSV
 * Manager, i.e. the manager at export time) is not the one in force at period
 * end are flagged `reviewer_mismatch` and logged on the run.
 *
 * An imported cycle whose dates all fall in one semester gets that semester
 * as its period and snapshot date (#58), and every
 * participant gets the goal snapshot a launched cycle takes: their goals that
 * overlap the period, captured as of its end.
 */
export async function finishHistoryImport(
  db: DbOrTx,
  { runId, reject }: { runId: string; reject: (r: IngestReject) => void },
): Promise<{ mismatches: number }> {
  const touched = await db
    .selectDistinct({ cycleId: historyImportRow.cycleId })
    .from(historyImportRow)
    .where(eq(historyImportRow.runId, runId));
  const cycleIds = touched.flatMap((t) => (t.cycleId ? [t.cycleId] : []));
  let mismatches = 0;
  for (const cycleId of cycleIds) {
    mismatches += await db.transaction((tx) =>
      refreshCycle(tx, cycleId, runId, reject),
    );
  }
  return { mismatches };
}

async function refreshCycle(
  tx: DbOrTx,
  cycleId: string,
  runId: string,
  reject: (r: IngestReject) => void,
): Promise<number> {
  const [cycle] = await tx
    .select()
    .from(reviewCycle)
    .where(eq(reviewCycle.id, cycleId));
  if (cycle.sourceSystem === "bamboo_export") {
    const snapped = snapToSemester(cycle, await semesterConfig(tx));
    if (
      snapped &&
      (snapped.periodStart !== cycle.periodStart ||
        snapped.periodEnd !== cycle.periodEnd)
    ) {
      const period = { ...snapped, snapshotDate: snapped.periodEnd };
      await tx
        .update(reviewCycle)
        .set(period)
        .where(eq(reviewCycle.id, cycle.id));
      Object.assign(cycle, period);
    }
  }
  const asOf = cycle.snapshotDate;
  // A cycle of this app someone chose for held-back rows keeps the snapshots
  // it took at launch: only imported cycles are (re)computed here.
  if (cycle.sourceSystem === "bamboo_export") {
    await refreshParticipants(tx, cycle);
  }

  // Manager requests vs the manager in force at period end.
  const asOfManager = aliasedTable(person, "as_of_manager");
  const managerReviews = await tx
    .select({
      requestId: reviewRequest.id,
      sourceId: reviewRequest.sourceId,
      reviewerPersonId: reviewRequest.reviewerPersonId,
      snapManagerPersonId: cycleParticipant.snapManagerPersonId,
      flagged: importedRequest.reviewerMismatch,
      csvName: importedRequest.csvReviewerName,
      asOfName: asOfManager.displayName,
      writtenNow: reviewRequest.ingestRunId,
    })
    .from(reviewRequest)
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .innerJoin(importedRequest, eq(importedRequest.requestId, reviewRequest.id))
    .leftJoin(
      asOfManager,
      eq(asOfManager.id, cycleParticipant.snapManagerPersonId),
    )
    .where(
      and(
        eq(reviewRequest.cycleId, cycleId),
        eq(reviewRequest.relationship, "manager"),
      ),
    );
  let mismatches = 0;
  for (const r of managerReviews) {
    const mismatch = r.reviewerPersonId !== r.snapManagerPersonId;
    if (mismatch !== r.flagged) {
      await tx
        .update(importedRequest)
        .set({ reviewerMismatch: mismatch })
        .where(eq(importedRequest.requestId, r.requestId));
      // review_request carries the flag too (#12), for the manager review UI.
      await tx
        .update(reviewRequest)
        .set({ reviewerMismatch: mismatch })
        .where(eq(reviewRequest.id, r.requestId));
    }
    // Count and log what this run wrote (or newly flagged), not the cycle's
    // whole history on every run.
    if (!mismatch || (r.writtenNow !== runId && mismatch === r.flagged)) {
      continue;
    }
    mismatches++;
    reject({
      sourceId: r.sourceId?.replace(/#manager$/, "") ?? null,
      code: "reviewer_mismatch",
      reason:
        `Manager review of "${cycle.name}": the report names ${r.csvName ?? "?"} ` +
        `but the manager at ${asOf} was ${r.asOfName ?? "nobody"}`,
      column: "Manager",
      values: { Manager: r.csvName, asOfManager: r.asOfName },
    });
  }
  return mismatches;
}

/**
 * Every participant's snapshot as of the cycle's snapshot date (the same one
 * a launched cycle takes, review-core), and their goal snapshot: the goals
 * that overlap the period, captured as of its end.
 */
async function refreshParticipants(
  tx: DbOrTx,
  cycle: { id: string; snapshotDate: string; periodEnd: string },
) {
  const participants = await tx
    .select()
    .from(cycleParticipant)
    .where(eq(cycleParticipant.cycleId, cycle.id));
  const fresh = await snapshots(
    tx,
    cycle.id,
    participants.map((p) => p.revieweePersonId),
    cycle.snapshotDate,
  );
  for (const [i, p] of participants.entries()) {
    const snap = fresh[i];
    const same = (Object.keys(snap) as (keyof typeof snap)[]).every(
      (k) => p[k] === snap[k],
    );
    if (!same) {
      await tx
        .update(cycleParticipant)
        .set(snap)
        .where(eq(cycleParticipant.id, p.id));
    }
  }
  await snapshotGoalsForParticipants(
    tx,
    participants.map((p) => p.id),
    new Date(`${cycle.periodEnd}T12:00:00Z`),
  );
}
