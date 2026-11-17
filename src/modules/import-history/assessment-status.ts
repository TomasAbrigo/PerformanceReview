import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { assessmentProgress, type ProgressStatus } from "@/db/schema";
import type { HandlerContext, HandlerOutcome } from "@/modules/ingest/handlers";
import { emptyTally, recordRow, resolveRow } from "./assessment";
import { cycleForPeriod } from "./cycle-target";
import { ensureParticipant, SOURCE } from "./cycles";
import { parseReportPeriod } from "./dates";

const text = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .optional()
  .transform((v) =>
    v === null || v === undefined || String(v).trim() === ""
      ? null
      : String(v).trim(),
  );

const STATUS: [RegExp, ProgressStatus][] = [
  [/^(completado|completada|completed|complete|submitted)\b/i, "submitted"],
  [/^(en curso|en progreso|in progress)\b/i, "in_progress"],
  [/^(no iniciado|no iniciada|not started)\b/i, "not_started"],
  [/^(n\/a|no aplica|not applicable)\b/i, "not_applicable"],
];

/**
 * A status cell of the Assessment Progress export: "Completado", "No
 * iniciado", "En curso" (or English), the manager's followed by who
 * ("Completed by Ana Pérez", "No iniciado por Ana Pérez").
 */
export function parseStatusCell(
  cell: string | null,
): { status: ProgressStatus; by: string | null } | null {
  if (cell === null) return { status: "not_applicable", by: null };
  for (const [pattern, status] of STATUS) {
    const match = pattern.exec(cell);
    if (!match) continue;
    const by = /\s(?:by|por)\s+(.+)$/i.exec(cell.slice(match[0].length));
    return { status, by: by ? by[1].trim() : null };
  }
  return null;
}

/**
 * One period row of Bamboo's Assessment Progress export as grouped by
 * person (profile `bamboo-assessment-status`; FileSourceAdapter has joined it
 * with its person row: name and employee number).
 */
export const stagedStatusSchema = z
  .object({
    format: z.literal("assessment_status"),
    fields: z.object({
      employee_name: text.pipe(z.string({ message: "The person is empty" })),
      employee_number: text,
      period: text.pipe(z.string({ message: "The period is empty" })),
      self_status: text,
      manager_status: text,
      follow_up_notes: text,
    }),
    dateFormat: z.enum(["mdy", "dmy"]).optional(),
  })
  .transform((row, ctx) => {
    const f = row.fields;
    const period = parseReportPeriod(f.period, row.dateFormat);
    if (!period) {
      ctx.addIssue({
        code: "custom",
        message: `Period "${f.period}" is not "MM/DD/YYYY - MM/DD/YYYY"`,
      });
      return z.NEVER;
    }
    const self = parseStatusCell(f.self_status);
    const manager = parseStatusCell(f.manager_status);
    for (const [label, value, parsed] of [
      ["Self status", f.self_status, self],
      ["Manager status", f.manager_status, manager],
    ] as const) {
      if (!parsed) {
        ctx.addIssue({
          code: "custom",
          message: `${label} "${value}" is not a known status (Completado, En curso, No iniciado)`,
        });
        return z.NEVER;
      }
    }
    return {
      ...row,
      fields: {
        ...f,
        period_start: period.start,
        period_end: period.end,
        self_status: self!.status,
        manager_status: manager!.status,
        manager_name: manager!.by,
      },
    };
  });
export type StagedStatus = z.infer<typeof stagedStatusSchema>;

/**
 * One period row -> the participant's `assessment_progress` in the cycle of
 * that review period (created on first sight, like the raw report does).
 * The person by employee number (the name only proposes candidates); the
 * manager named in the status cell, when it differs from the snapshot
 * manager, is a reviewer mismatch.
 */
export async function upsertStatus(
  tx: DbOrTx,
  staged: StagedStatus,
  ctx: HandlerContext,
): Promise<HandlerOutcome> {
  const { fields } = staged;
  const cycle = await cycleForPeriod(
    tx,
    ctx,
    fields.period_start,
    fields.period_end,
  );
  const tally = emptyTally();
  const { revieweeId, reviewerId, issue } = await resolveRow(
    tx,
    ctx,
    "assessment_progress",
    ctx.sourceId,
    { reviewee: fields.employee_name, reviewer: fields.manager_name },
    {
      ids: fields.employee_number
        ? { employee_number: fields.employee_number }
        : undefined,
      reviewerOptional: true,
    },
  );

  let written: "inserted" | "updated" | "unchanged" | null = null;
  if (revieweeId) {
    const participant = await ensureParticipant(tx, cycle, revieweeId);
    if (participant.created) tally.participantsCreated++;
    const [found] = await tx
      .select({
        id: assessmentProgress.id,
        hash: assessmentProgress.payloadHash,
      })
      .from(assessmentProgress)
      .where(
        and(
          eq(assessmentProgress.cycleId, cycle.id),
          eq(assessmentProgress.participantId, participant.id),
        ),
      );
    if (found && found.hash === ctx.hash) {
      written = "unchanged";
    } else {
      const values = {
        cycleId: cycle.id,
        participantId: participant.id,
        selfStatus: fields.self_status,
        managerStatus: fields.manager_status,
        assessed:
          fields.self_status === "submitted" &&
          fields.manager_status === "submitted",
        followUpNotes: fields.follow_up_notes,
        csvManagerName: fields.manager_name,
        reviewerMismatch:
          reviewerId !== null && reviewerId !== participant.snapManagerPersonId,
        sourceSystem: SOURCE,
        sourceId: ctx.sourceId,
        payloadHash: ctx.hash,
        ingestRunId: ctx.runId,
        updatedAt: new Date(),
      };
      if (found) {
        await tx
          .update(assessmentProgress)
          .set(values)
          .where(eq(assessmentProgress.id, found.id));
        written = "updated";
      } else {
        await tx.insert(assessmentProgress).values(values);
        written = "inserted";
      }
    }
  }

  const result: HandlerOutcome["result"] = issue
    ? "ignoredIssueId" in issue
      ? "ignored"
      : "issues"
    : (written ?? "unchanged");
  await recordRow(tx, {
    runId: ctx.runId,
    entity: "assessment_progress",
    sourceId: ctx.sourceId,
    cycleId: cycle.id,
    result,
    tally,
    issueId: issue && "issueId" in issue ? issue.issueId : null,
  });
  return { result, rejects: [] };
}
