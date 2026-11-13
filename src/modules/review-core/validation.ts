import { z } from "zod";
import {
  anonymityModes,
  cycleStatuses,
  type DueDatePhase,
  dueDatePhases,
  scheduleKinds,
} from "./status";

const isoDate = z.iso.date("invalid_date");
const uuid = z.uuid("invalid");
const list = z.array(z.string().trim().min(1)).optional();

export const participantFilterInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({
    kind: z.literal("filter"),
    departments: list,
    divisions: list,
    locations: list,
    jobTitles: list,
    statuses: list,
  }),
  z.object({
    kind: z.literal("people"),
    personIds: z.array(uuid).min(1, "required"),
  }),
]);

const dueDatesInput = z
  .object(
    Object.fromEntries(dueDatePhases.map((p) => [p, isoDate.optional()])) as {
      [K in DueDatePhase]: z.ZodOptional<typeof isoDate>;
    },
  )
  .superRefine((dates, ctx) => {
    // Phases must be due in order (missing phases are skipped).
    let last: { phase: DueDatePhase; date: string } | null = null;
    for (const phase of dueDatePhases) {
      const date = dates[phase];
      if (!date) continue;
      if (last && date < last.date) {
        ctx.addIssue({ code: "custom", path: [phase], message: "date_order" });
      }
      last = { phase, date };
    }
  });

const cycleFields = z.object({
  name: z.string().trim().min(1, "required"),
  description: z.string().trim().nullish(),
  periodStart: isoDate,
  periodEnd: isoDate,
  snapshotDate: isoDate,
  components: z.object({
    self: z.boolean(),
    manager: z.boolean(),
    peer: z.boolean(),
    upward: z.boolean(),
    calibration: z.boolean(),
  }),
  anonymity: z.object({
    peer: z.enum(anonymityModes),
    upward: z.enum(anonymityModes),
  }),
  finalScaleId: uuid.nullish(),
  templateId: uuid.nullish(),
  dueDates: dueDatesInput.default({}),
  scheduleKind: z.enum(scheduleKinds).default("fixed"),
  hireDateSchedule: z
    .object({ offsetsDays: z.array(z.number().int().positive()) })
    .nullish(),
  participantFilter: participantFilterInput.default({ kind: "all" }),
});

export const cycleInput = cycleFields.superRefine((c, ctx) => {
  if (c.periodEnd < c.periodStart) {
    ctx.addIssue({
      code: "custom",
      path: ["periodEnd"],
      message: "date_order",
    });
  }
});

/** Partial update; after launch only `name` and `dueDates` are accepted. */
export const cycleUpdateInput = cycleFields.partial();

export const transitionInput = z.object({
  to: z.enum(cycleStatuses),
  note: z.string().trim().nullish(),
});

export type CycleInput = z.input<typeof cycleInput>;
export type CycleUpdateInput = z.input<typeof cycleUpdateInput>;
export type ParticipantFilterInput = z.input<typeof participantFilterInput>;
