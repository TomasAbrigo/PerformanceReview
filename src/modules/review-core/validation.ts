import { z } from "zod";
import {
  anonymityModes,
  cycleStatuses,
  type DueDatePhase,
  dueDatePhases,
  hireMilestoneDays,
  hireWindowWeeks,
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

export const hireDateScheduleInput = z.object({
  milestoneDays: z.literal(hireMilestoneDays, "invalid"),
  windowWeeks: z.literal(hireWindowWeeks, "invalid"),
});

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
  hireDateSchedule: hireDateScheduleInput.nullish(),
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
  if (c.scheduleKind === "hire_date" && !c.hireDateSchedule) {
    ctx.addIssue({
      code: "custom",
      path: ["hireDateSchedule"],
      message: "required",
    });
  }
});

/** Partial update; after launch only `name` and `dueDates` are accepted. */
export const cycleUpdateInput = cycleFields.partial();

export const transitionInput = z.object({
  to: z.enum(cycleStatuses),
  note: z.string().trim().nullish(),
});

/** A participant group of a cycle: those matching `filter` use `templateId`. */
export const cycleGroupInput = z.object({
  name: z.string().trim().min(1, "required"),
  templateId: uuid,
  filter: participantFilterInput,
});

/** Ordered: a person goes to the first group whose filter matches. */
export const cycleGroupsInput = z
  .array(cycleGroupInput)
  .max(20)
  .superRefine((groups, ctx) => {
    const seen = new Set<string>();
    groups.forEach((g, i) => {
      const key = g.name.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: [i, "name"],
          message: "duplicate_name",
        });
      }
      seen.add(key);
    });
  });

/** Groups to preview in the wizard: the same cap as a saved cycle. */
export const previewGroupsInput = z
  .array(z.object({ filter: participantFilterInput }))
  .max(20);

/** Extra days the hire-date enrollment looks back past the window (catching up). */
export const lookbackDaysInput = z.number().int().min(0).max(365);

/** The word a duplicate adds to the name; it comes from the caller's language. */
export const duplicateInput = z.object({
  suffix: z.string().trim().min(1, "required"),
});

export type CycleGroupInput = z.input<typeof cycleGroupInput>;
export type CycleInput = z.input<typeof cycleInput>;
export type CycleUpdateInput = z.input<typeof cycleUpdateInput>;
export type ParticipantFilterInput = z.input<typeof participantFilterInput>;
