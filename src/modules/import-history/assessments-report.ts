import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import type { HandlerContext, HandlerOutcome } from "@/modules/ingest/handlers";
import {
  ASSESSMENTS_REPORT_QUESTIONS,
  customQuestionSchema,
} from "@/modules/lake/profiles";
import {
  atNoon,
  columnsOf,
  emptyTally,
  recordRow,
  resolveRow,
} from "./assessment";
import { cycleForPeriod } from "./cycle-target";
import {
  answeredCells,
  ensureParticipant,
  ensureQuestions,
  likertOverridesOf,
  saveAnswers,
  upsertRequest,
} from "./cycles";
import { parseReportDate } from "./dates";
import { customQuestionColumns, type QuestionColumn } from "./questions";

const cell = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .optional()
  .transform((v) =>
    v === null || v === undefined || String(v).trim() === ""
      ? null
      : String(v).trim(),
  );

/**
 * A row of Bamboo's raw assessments report (profile
 * `bamboo-assessments-report`, #83): one person (EEID, work email) and one
 * review period, both sides' answers and completion dates.
 */
export const stagedReportSchema = z
  .object({
    format: z.literal("assessments_report"),
    fields: z.object({
      employee_bamboo_id: cell,
      work_email: cell,
      employee_name: cell,
      period_start: z.unknown(),
      self_completed_on: z.unknown().optional(),
      manager_completed_on: z.unknown().optional(),
      manager_name: cell,
    }),
    raw: z.record(z.string(), z.unknown()),
    customQuestions: z.array(customQuestionSchema).optional(),
    dateFormat: z.enum(["mdy", "dmy"]).optional(),
  })
  .transform((row, ctx) => {
    const f = row.fields;
    const start = parseReportDate(f.period_start, row.dateFormat);
    if (!start) {
      ctx.addIssue({
        code: "custom",
        message: `Review Period Start "${String(f.period_start ?? "")}" is missing or not a date`,
      });
      return z.NEVER;
    }
    if (!f.employee_bamboo_id && !f.work_email && !f.employee_name) {
      ctx.addIssue({
        code: "custom",
        message: "The row has no EEID, work email or name",
      });
      return z.NEVER;
    }
    const date = (value: unknown, label: string) => {
      if (value === null || value === undefined || String(value).trim() === "")
        return null;
      const parsed = parseReportDate(value, row.dateFormat);
      if (!parsed) {
        ctx.addIssue({
          code: "custom",
          message: `${label} "${String(value)}" is not a date`,
        });
      }
      return parsed;
    };
    return {
      ...row,
      fields: {
        ...f,
        period_start: start,
        self_completed_on: date(
          f.self_completed_on,
          "Self Assessment Completed Date",
        ),
        manager_completed_on: date(
          f.manager_completed_on,
          "Manager Assessment Completed Date",
        ),
      },
    };
  });
export type StagedReport = z.infer<typeof stagedReportSchema>;

/**
 * One raw report row -> the cycle of its review period, its questions (the
 * configured ones plus each custom pair's text of this row), the participant
 * (snapshot as of the period start), and a self and a manager request for
 * the sides that have a completion date or an answer. The person is found by
 * EEID, then work email (the name only proposes candidates in the queue).
 * The manager side is written by the person named in "Manager At Time Of
 * Assessment" or, when that name matches nobody, by the snapshot manager;
 * a reviewer other than the snapshot manager is a reviewer mismatch.
 */
export async function upsertReportAssessment(
  tx: DbOrTx,
  staged: StagedReport,
  ctx: HandlerContext,
): Promise<HandlerOutcome> {
  const { fields, raw } = staged;
  const { sourceId } = ctx;
  const cycle = await cycleForPeriod(tx, ctx, fields.period_start);
  const columns: QuestionColumn[] = [
    ...columnsOf(
      ctx.cache,
      Object.keys(raw),
      ctx.questions ?? ASSESSMENTS_REPORT_QUESTIONS,
    ),
    ...customQuestionColumns(staged.customQuestions ?? [], raw),
  ];
  const revisions = await ensureQuestions(tx, cycle.id, columns, ctx.cache);

  const tally = emptyTally();
  const rejects: string[] = [];
  // The manager's name: matched when unique; matching nobody falls back to
  // the snapshot manager; matching several people goes to the queue.
  const { revieweeId, reviewerId, reviewerFailed, issue } = await resolveRow(
    tx,
    ctx,
    "assessment",
    sourceId,
    { reviewee: fields.employee_name, reviewer: fields.manager_name },
    {
      ids: {
        bamboo_id: fields.employee_bamboo_id,
        work_email: fields.work_email,
      },
      reviewerOptional: true,
    },
  );

  const results: ("inserted" | "updated" | "unchanged" | "superseded")[] = [];
  let overwritten = 0;
  if (revieweeId) {
    const participant = await ensureParticipant(tx, cycle, revieweeId);
    if (participant.created) tally.participantsCreated++;
    const managerId = reviewerFailed
      ? null
      : (reviewerId ?? participant.snapManagerPersonId);
    const sides = [
      {
        side: "self" as const,
        reviewer: revieweeId,
        date: fields.self_completed_on,
      },
      {
        side: "manager" as const,
        reviewer: managerId,
        date: fields.manager_completed_on,
      },
    ];
    for (const { side, reviewer, date } of sides) {
      const sideColumns = columns.filter((c) => c.relationship === side);
      // An empty side (no date, no answer) is not a review: nothing written.
      if (!date && answeredCells(sideColumns, raw) === 0) continue;
      if (!reviewer) {
        // In the identity queue already (an ambiguous name): no reject.
        if (reviewerFailed) continue;
        rejects.push(
          `The manager review has no reviewer: "${fields.manager_name ?? ""}" matches nobody and the person had no manager at ${cycle.periodStart}`,
        );
        continue;
      }
      // Answers without a completion date: a draft, never a made-up date.
      const request = await upsertRequest(tx, {
        cycleId: cycle.id,
        participantId: participant.id,
        reviewerPersonId: reviewer,
        relationship: side,
        sourceId: `${sourceId}#${side}`,
        hash: ctx.hash,
        runId: ctx.runId,
        submittedAt: date ? atNoon(date) : null,
        draft: !date,
        declinedAt: null,
        csvReviewerName: side === "manager" ? fields.manager_name : null,
        reviewerMismatch:
          side === "manager" && reviewer !== participant.snapManagerPersonId,
      });
      results.push(request.result);
      if (request.overwroteNative) overwritten++;
      if (request.result === "superseded") {
        rejects.push(
          `A later assessment of ${fields.employee_bamboo_id ?? fields.work_email ?? sourceId} in "${cycle.name}" replaces this ${side} review (one per cycle)`,
        );
        continue;
      }
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
        {
          cycleId: cycle.id,
          runId: ctx.runId,
          overrides: await likertOverridesOf(tx, ctx.cache),
        },
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
  return {
    result,
    rejects,
    ...(overwritten ? { counts: { nativeOverwritten: overwritten } } : {}),
  };
}
