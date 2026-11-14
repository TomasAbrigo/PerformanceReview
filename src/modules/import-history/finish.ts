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
import { jobsAsOf } from "@/modules/org-history/queries";

/**
 * After a run, for each cycle it touched: rows are processed one by one and
 * each widens the cycle's period (min/max of the assessment dates, snapshot =
 * period end), so only now is the period final. Every participant's snapshot
 * is (re)computed as of it, and manager requests whose reviewer (the CSV
 * Manager, i.e. the manager at export time) is not the one in force at period
 * end are flagged `reviewer_mismatch` and logged on the run.
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
  const asOf = cycle.snapshotDate;

  const participants = await tx
    .select()
    .from(cycleParticipant)
    .where(eq(cycleParticipant.cycleId, cycleId));
  const jobs = await jobsAsOf(
    tx,
    participants.map((p) => p.revieweePersonId),
    asOf,
  );
  for (const p of participants) {
    const job = jobs.get(p.revieweePersonId);
    const snap = {
      snapshotAsOf: asOf,
      snapManagerPersonId: job?.managerPersonId ?? null,
      snapDepartment: job?.department ?? null,
      snapDivision: job?.division ?? null,
      snapJobTitle: job?.jobTitle ?? null,
      snapLocation: job?.location ?? null,
      snapJobHistoryId: job?.id ?? null,
    };
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
    }
    if (!mismatch) continue;
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
