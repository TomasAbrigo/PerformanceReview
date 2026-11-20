import { aliasedTable, and, eq, inArray, sql } from "drizzle-orm";
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
import { emptyTally, recordRow } from "./assessment";
import { SOURCE } from "./cycles";
import { reapplyLikertMappings } from "./likert-reapply";
import { markYesNoQuestions } from "./yes-no";
import {
  isSemesterLabel,
  legacySemesterConfig,
  snapshotDateFor,
  snapToSemester,
} from "./semester";

/**
 * After a run, for each cycle it touched: rows are processed one by one and
 * each widens the cycle's period (min/max of the assessment dates, snapshot =
 * period end), so only now is the period final. Every participant's snapshot
 * is (re)computed as of it, and manager requests whose reviewer (the CSV
 * Manager, i.e. the manager at export time) is not the one in force at period
 * end are flagged `reviewer_mismatch` and logged on the run.
 *
 * A cycle created for a semester (rows without a cycle name, named like
 * "2025-H1") whose dates all fall in it gets that semester as its period; its
 * snapshot is as of the semester end, or today while the semester is not
 * over (never a future date). Named cycles keep the period of their dates.
 * Every
 * participant gets the goal snapshot a launched cycle takes: their goals that
 * overlap the period, captured as of its end.
 *
 * Finally the
 * retention/engagement answers are remapped with the option count of their
 * column (reapplyLikertMappings), and the custom text questions answered
 * with a yes/no are marked as yes/no questions (markYesNoQuestions).
 */
export async function finishHistoryImport(
  db: DbOrTx,
  {
    runId,
    reject,
    seen,
  }: {
    runId: string;
    reject: (r: IngestReject) => void;
    /**
     * Every row key of a whole raw assessments report (#132): the rows of
     * its cycles that an earlier import wrote and this file no longer has
     * are dropped. Absent (other formats, a resumed run): nothing dropped.
     */
    seen?: Set<string>;
  },
): Promise<{ mismatches: number; deleted: number }> {
  const touched = await db
    .selectDistinct({ cycleId: historyImportRow.cycleId })
    .from(historyImportRow)
    .where(eq(historyImportRow.runId, runId));
  const cycleIds = touched.flatMap((t) => (t.cycleId ? [t.cycleId] : []));
  const deleted =
    seen && seen.size > 0
      ? await dropAbsentReportRows(db, { runId, seen, cycleIds })
      : 0;
  let mismatches = 0;
  for (const cycleId of cycleIds) {
    mismatches += await db.transaction((tx) =>
      refreshCycle(tx, cycleId, runId, reject),
    );
  }
  // Rows were mapped one by one assuming 5 options; now that the whole file
  // is in, the option count of each Likert column is known (A-D vs A-E).
  await reapplyLikertMappings(db, { cycleIds });
  // Same for the custom questions: whether one is yes/no shows in its column.
  await markYesNoQuestions(db, { cycleIds });
  return { mismatches, deleted };
}

/**
 * The raw assessments report is the whole list of its cycles (#132): an
 * imported request of one of the run's cycles whose row came from that
 * report (raw_record, format assessments_report) and is not in this file
 * any more is dropped, with its answers, and counted on the result screen
 * as a `removed` row. Requests of other formats are never touched.
 */
async function dropAbsentReportRows(
  db: DbOrTx,
  {
    runId,
    seen,
    cycleIds,
  }: { runId: string; seen: Set<string>; cycleIds: string[] },
): Promise<number> {
  if (cycleIds.length === 0) return 0;
  const candidates = await db
    .select({
      id: reviewRequest.id,
      sourceId: reviewRequest.sourceId,
      cycleId: reviewRequest.cycleId,
    })
    .from(reviewRequest)
    .where(
      and(
        eq(reviewRequest.sourceSystem, SOURCE),
        inArray(reviewRequest.cycleId, cycleIds),
        sql`exists (
          select 1 from raw_record rr
          where rr.entity = 'assessment'
            and rr.source_id = regexp_replace(${reviewRequest.sourceId}, '#[a-z_]+$', '')
            and rr.payload->>'format' = 'assessments_report'
        )`,
      ),
    );
  const absent = new Map<string, { cycleId: string; ids: string[] }>();
  for (const c of candidates) {
    const key = c.sourceId!.replace(/#[a-z_]+$/, "");
    if (seen.has(key)) continue;
    const entry = absent.get(key) ?? { cycleId: c.cycleId, ids: [] };
    entry.ids.push(c.id);
    absent.set(key, entry);
  }
  let deleted = 0;
  for (const [sourceId, { cycleId, ids }] of absent) {
    await db.transaction(async (tx) => {
      await tx.delete(reviewRequest).where(inArray(reviewRequest.id, ids));
      await recordRow(tx, {
        runId,
        entity: "assessment",
        sourceId,
        cycleId,
        result: "removed",
        tally: { ...emptyTally(), requestsRemoved: ids.length },
      });
    });
    deleted += ids.length;
  }
  return deleted;
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
  // Only cycles the import named after a semester (rows without a cycle
  // name): a cycle the file names keeps the period of its dates.
  if (
    cycle.sourceSystem === "bamboo_export" &&
    isSemesterLabel(cycle.sourceId)
  ) {
    const snapped = snapToSemester(cycle, await legacySemesterConfig(tx));
    if (
      snapped &&
      (snapped.periodStart !== cycle.periodStart ||
        snapped.periodEnd !== cycle.periodEnd)
    ) {
      const period = {
        ...snapped,
        snapshotDate: snapshotDateFor(snapped.periodEnd),
      };
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
      unmatched: importedRequest.reviewerUnmatched,
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
    // A name that matched nobody fell back to the snapshot manager: still a
    // mismatch, so the attribution is never silent (#132).
    const mismatch =
      r.unmatched || r.reviewerPersonId !== r.snapManagerPersonId;
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
      reason: r.unmatched
        ? `Manager review of "${cycle.name}": the report names ${r.csvName ?? "?"}, ` +
          `who matches nobody; it was attributed to the manager at ${asOf}, ${r.asOfName ?? "nobody"}`
        : `Manager review of "${cycle.name}": the report names ${r.csvName ?? "?"} ` +
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
