import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { historyImportRow } from "@/db/schema";
import { closeOpenIssue, raiseIssue } from "@/modules/identity/raise";
import type { HandlerContext, HandlerOutcome } from "@/modules/ingest/handlers";
import {
  answeredCells,
  ensureParticipant,
  ensureQuestions,
  isoDate,
  saveAnswers,
  SOURCE,
  upsertImportedCycle,
  upsertRequest,
} from "./cycles";
import { loadNameIndex, matchName, type NameIndex } from "./names";
import { detectQuestionColumns, type QuestionColumn } from "./questions";

const cell = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .optional()
  .transform((v) =>
    v === null || v === undefined || String(v).trim() === ""
      ? null
      : String(v).trim(),
  );

/**
 * A row of Bamboo's Employee Performance report as FileSourceAdapter hands it
 * over (profile `bamboo-employee-performance`): mapped fields, plus the row
 * under its original headers (the question columns).
 */
export const stagedAssessmentSchema = z.object({
  fields: z.object({
    employee_name: cell.pipe(z.string({ message: "Employee Name is empty" })),
    manager_name: cell,
    review_cycle: cell.pipe(z.string({ message: "Review Cycle is empty" })),
    assessment_date: z
      .unknown()
      .transform(isoDate)
      .pipe(
        z.string({
          message:
            "Assessment Date is missing or not a date (only Employee Performance rows can be imported as assessments)",
        }),
      ),
  }),
  raw: z.record(z.string(), z.unknown()),
});
export type StagedAssessment = z.infer<typeof stagedAssessmentSchema>;

/** What one report row did, for the result screen. */
export type RowTally = {
  participantsCreated: number;
  requestsCreated: number;
  requestsUnchanged: number;
  answersCreated: number;
  answersUnchanged: number;
};

export const emptyTally = (): RowTally => ({
  participantsCreated: 0,
  requestsCreated: 0,
  requestsUnchanged: 0,
  answersCreated: 0,
  answersUnchanged: 0,
});

export async function nameIndexOf(
  tx: DbOrTx,
  cache: Map<string, unknown>,
): Promise<NameIndex> {
  let index = cache.get("nameIndex") as NameIndex | undefined;
  if (!index) {
    index = await loadNameIndex(tx);
    cache.set("nameIndex", index);
  }
  return index;
}

export async function recordRow(
  tx: DbOrTx,
  row: {
    runId: string;
    entity: "assessment" | "feedback";
    sourceId: string;
    cycleId: string;
    result: HandlerOutcome["result"];
    tally: RowTally;
    issueId?: string | null;
  },
) {
  await tx
    .insert(historyImportRow)
    .values({
      runId: row.runId,
      entity: row.entity,
      sourceId: row.sourceId,
      cycleId: row.cycleId,
      result: row.result,
      issueId: row.issueId ?? null,
      ...row.tally,
    })
    .onConflictDoNothing();
}

/**
 * Who a row is about and who wrote it, by name. Names that do not resolve to
 * exactly one person send the row to the identity queue (it is never
 * dropped): the result says what could not be resolved.
 */
export async function resolveRow(
  tx: DbOrTx,
  ctx: HandlerContext,
  entity: "assessment" | "feedback",
  sourceId: string,
  names: { reviewee: string; reviewer: string | null },
) {
  const index = await nameIndexOf(tx, ctx.cache);
  const reviewee = matchName(index, names.reviewee);
  const reviewer = names.reviewer ? matchName(index, names.reviewer) : null;
  const failed = !("personId" in reviewee)
    ? reviewee
    : reviewer && !("personId" in reviewer)
      ? reviewer
      : null;
  let issue: { issueId: string } | { ignoredIssueId: string } | null = null;
  if (failed) {
    issue = await raiseIssue(tx, {
      source: SOURCE,
      entity,
      sourceId,
      runId: ctx.runId,
      payload: ctx.payload,
      hash: ctx.hash,
      reason: failed.reason,
      candidates: failed.candidates,
    });
  } else {
    await closeOpenIssue(
      tx,
      { source: SOURCE, entity, sourceId },
      {
        action: "link",
        auto: true,
        personId: (reviewee as { personId: string }).personId,
      },
    );
  }
  return {
    revieweeId: "personId" in reviewee ? reviewee.personId : null,
    reviewerId: reviewer && "personId" in reviewer ? reviewer.personId : null,
    issue,
  };
}

function columnsOf(
  cache: Map<string, unknown>,
  headers: string[],
): QuestionColumn[] {
  const key = `columns:${headers.join("\u0000")}`;
  let columns = cache.get(key) as QuestionColumn[] | undefined;
  if (!columns) {
    columns = detectQuestionColumns(headers);
    cache.set(key, columns);
  }
  return columns;
}

/** Midday UTC of a date: stays on that day in every timezone we show. */
export const atNoon = (date: string) => new Date(`${date}T12:00:00Z`);

/**
 * One Employee Performance row -> imported cycle, its synthesized questions,
 * the participant (snapshot as of period end), the self and manager requests
 * (submitted on the Assessment Date) and their answers.
 */
export async function upsertAssessment(
  tx: DbOrTx,
  staged: StagedAssessment,
  ctx: HandlerContext,
): Promise<HandlerOutcome> {
  const { fields, raw } = staged;
  const { sourceId } = ctx;
  const date = fields.assessment_date;
  const cycle = await upsertImportedCycle(tx, {
    name: fields.review_cycle,
    date,
    runId: ctx.runId,
    widen: true,
  });
  const columns = columnsOf(ctx.cache, Object.keys(raw));
  const revisions = await ensureQuestions(tx, cycle.id, columns);

  const tally = emptyTally();
  const rejects: string[] = [];
  const { revieweeId, reviewerId, issue } = await resolveRow(
    tx,
    ctx,
    "assessment",
    sourceId,
    { reviewee: fields.employee_name, reviewer: fields.manager_name },
  );

  const results: ("inserted" | "updated" | "unchanged")[] = [];
  if (revieweeId) {
    const participant = await ensureParticipant(tx, cycle, revieweeId);
    if (participant.created) tally.participantsCreated++;
    const sides: { side: "self" | "manager"; reviewer: string | null }[] = [
      { side: "self", reviewer: revieweeId },
      { side: "manager", reviewer: reviewerId },
    ];
    for (const { side, reviewer } of sides) {
      if (!reviewer) continue;
      const sideColumns = columns.filter((c) => c.relationship === side);
      const request = await upsertRequest(tx, {
        cycleId: cycle.id,
        participantId: participant.id,
        reviewerPersonId: reviewer,
        relationship: side,
        sourceId: `${sourceId}#${side}`,
        hash: ctx.hash,
        runId: ctx.runId,
        submittedAt: atNoon(date),
        declinedAt: null,
        csvReviewerName:
          side === "manager" ? fields.manager_name : fields.employee_name,
        reviewerMismatch:
          side === "manager" && reviewer !== participant.snapManagerPersonId,
      });
      results.push(request.result);
      if (request.result === "unchanged") {
        tally.requestsUnchanged++;
        tally.answersUnchanged += answeredCells(sideColumns, raw);
        continue;
      }
      if (request.result === "inserted") tally.requestsCreated++;
      const saved = await saveAnswers(
        tx,
        request.id,
        sideColumns,
        revisions,
        raw,
      );
      tally.answersCreated += saved.created;
      tally.answersUnchanged += saved.updated;
      rejects.push(...saved.invalid);
    }
  }

  const result: HandlerOutcome["result"] = issue
    ? "ignoredIssueId" in issue
      ? "ignored"
      : "issues"
    : results.includes("inserted")
      ? "inserted"
      : results.includes("updated")
        ? "updated"
        : "unchanged";
  await recordRow(tx, {
    runId: ctx.runId,
    entity: "assessment",
    sourceId,
    cycleId: cycle.id,
    result,
    tally,
    issueId: issue && "issueId" in issue ? issue.issueId : null,
  });
  return { result, rejects };
}
