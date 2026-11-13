import { z } from "zod";
import { goalStatuses } from "@/db/schema";
import { bambooId } from "@/modules/bamboo-client/schemas";

const optionalText = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    const s = v == null ? "" : String(v).trim();
    return s === "" ? null : s;
  });

/** Bamboo uses "0000-00-00" for empty dates and may append a time. */
const optionalDate = optionalText.transform((v) => {
  const day = v?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  return day && !day.startsWith("0000") ? day : null;
});

const optionalInstant = optionalText.transform((v) => {
  if (!v || v.startsWith("0000")) return null;
  const date = new Date(v);
  return Number.isNaN(date.getTime()) ? null : date;
});

const stagedMilestoneSchema = z.looseObject({
  id: bambooId,
  title: optionalText,
  completedDateTime: optionalInstant,
  lastUpdateDateTime: optionalInstant,
});

/** Validated, normalized goal (from a `GoalPayload`) ready for the upsert. */
export const stagedGoalSchema = z
  .looseObject({
    employeeId: bambooId,
    commentCount: z.number().int().min(0).nullish(),
    goal: z.looseObject({
      id: bambooId,
      title: optionalText,
      description: optionalText,
      percentComplete: z.number().nullish(),
      status: z.enum(goalStatuses),
      dueDate: optionalDate,
      completionDate: optionalDate,
      lastChangedDateTime: optionalInstant,
      alignsWithOptionId: optionalText,
      sharedWithEmployeeIds: z.array(bambooId).nullish(),
      milestones: z.array(stagedMilestoneSchema).nullish(),
    }),
  })
  .transform((p, ctx) => {
    const g = p.goal;
    if (!g.title) {
      ctx.addIssue({ code: "custom", message: "goal has no title" });
      return z.NEVER;
    }
    // A milestone is a checklist line: one without text would render as an
    // empty row, so the goal is held back like one without a title.
    const milestones = [];
    for (const [position, m] of (g.milestones ?? []).entries()) {
      if (!m.title) {
        ctx.addIssue({
          code: "custom",
          message: `milestone ${m.id} has no title`,
        });
        return z.NEVER;
      }
      milestones.push({
        sourceId: m.id,
        title: m.title,
        position,
        completedAt: m.completedDateTime,
        lastUpdateAt: m.lastUpdateDateTime,
      });
    }
    return {
      sourceId: g.id,
      ownerEmployeeId: p.employeeId,
      title: g.title,
      description: g.description,
      percentComplete: Math.min(
        100,
        Math.max(0, Math.round(g.percentComplete ?? 0)),
      ),
      status: g.status,
      dueDate: g.dueDate,
      completionDate: g.completionDate,
      lastChangedAt: g.lastChangedDateTime,
      alignsWithSourceId: g.alignsWithOptionId,
      commentCount: p.commentCount ?? 0,
      sharedWithEmployeeIds: [...new Set(g.sharedWithEmployeeIds ?? [])],
      milestones,
    };
  });

export type StagedGoal = z.infer<typeof stagedGoalSchema>;

/** A comment (from a `GoalCommentPayload`) ready for the upsert. */
export const stagedCommentSchema = z
  .looseObject({
    id: bambooId,
    authorUserId: optionalText,
    authorEmployeeId: optionalText,
    text: optionalText,
    createdAt: optionalInstant,
  })
  .transform((c) => ({
    sourceId: c.id,
    authorSourceUserId: c.authorUserId,
    authorEmployeeId: c.authorEmployeeId,
    text: c.text ?? "",
    postedAt: c.createdAt,
  }));

export type StagedComment = z.infer<typeof stagedCommentSchema>;
