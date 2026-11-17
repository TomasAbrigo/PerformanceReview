// Drizzle- and server-free: the versioned contract of the Arturía export.
// Field by field documentation: docs/arturia-schema.md.
import { z } from "zod";

export const SCHEMA_VERSION = "arturia-report.v1";
/** Bumped on every additive change of v1 (new optional field / section). */
export const SCHEMA_MINOR = 0;

const int = z.number().int().nonnegative();
const counts = z.array(int);

/** One group of an aggregate series; `other` marks the folded "Otros" cell. */
const group = z.object({
  label: z.string(),
  n: int,
  other: z.boolean(),
});

const sentimentCounts = z.object({
  positive: int,
  constructive: int,
  negative: int,
  total: int,
});

const executive = z.object({
  participants: int,
  progress: z.array(
    z.object({ relationship: z.string(), total: int, submitted: int }),
  ),
  bins: z.array(z.object({ from: z.number(), to: z.number() })),
  /** null when anonymized and any group is suppressed (no differencing). */
  distribution: counts.nullable(),
  byDepartment: z.array(group.extend({ mean: z.number().nullable(), counts })),
  /** People left out of the breakdown (their groups, Otros included, are under the minimum). */
  suppressed: int,
});

/** `n`: distinct participants of the group; `total`: its requests. */
const completionRow = group.extend({
  relationship: z.string(),
  total: int,
  submitted: int,
});
const completion = z.object({
  /** null when anonymized and any group is suppressed (no differencing). */
  byRelationship: z
    .array(
      z.object({
        relationship: z.string(),
        total: int,
        submitted: int,
        draft: int,
        declined: int,
      }),
    )
    .nullable(),
  byDepartment: z.array(completionRow),
  byManager: z.array(completionRow),
  /** Participants left out of each breakdown. */
  suppressed: z.object({ byDepartment: int, byManager: int }),
});

const band = z.enum(["low", "mid", "high"]);
const indicators = z.object({
  distribution: z.array(
    z.object({
      indicator: z.string(),
      groups: z.array(group.extend({ mean: z.number().nullable(), counts })),
      total: z
        .object({ n: int, mean: z.number().nullable(), counts })
        .nullable(),
      suppressed: int,
    }),
  ),
  riskMatrix: z
    .object({
      cells: z.array(
        z.object({
          retention: band,
          engagement: band,
          count: int.nullable(),
          risk: z.boolean(),
        }),
      ),
      total: int.nullable(),
      riskCount: int.nullable(),
    })
    .nullable(),
  alerts: z.array(
    z.object({
      kind: z.string(),
      indicator: z.string().nullable(),
      count: int,
    }),
  ),
});

const qualitative = z.object({
  sentimentByDimension: z.array(
    sentimentCounts.extend({ dimension: z.string(), other: z.boolean() }),
  ),
  trend: z.array(
    sentimentCounts.extend({
      cycleId: z.string(),
      cycleName: z.string(),
      periodEnd: z.string(),
    }),
  ),
  topThemes: z.array(
    z.object({
      theme: z.string(),
      count: int,
      other: z.boolean(),
      quotes: z.array(z.string()),
    }),
  ),
  suppressed: int,
});

const goals = z.object({
  participantsWithGoals: int,
  goals: int,
  completed: int,
  avgProgress: z.number().nullable(),
  byDepartment: z.array(
    group.extend({
      goals: int,
      completed: int,
      avgProgress: z.number().nullable(),
    }),
  ),
});

const status = z.string().nullable();
const person = z.object({
  personId: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  department: z.string().nullable(),
  manager: z.string().nullable(),
  selfStatus: status,
  managerStatus: status,
  retention: z.string().nullable(),
  engagement: z.string().nullable(),
  /** Share (0-1) of the person's labeled comments that are positive; null without labels. */
  positiveShare: z.number().min(0).max(1).nullable(),
  comments: int,
});

export const arturiaReportV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    schemaMinor: z.number().int().nonnegative(),
    generatedAt: z.iso.datetime(),
    locale: z.enum(["es", "en"]),
    cycle: z.object({
      id: z.string(),
      name: z.string(),
      periodStart: z.string(),
      periodEnd: z.string(),
    }),
    anonymized: z.boolean(),
    minGroupSize: z.number().int().positive(),
    sections: z.object({
      executive,
      /** null: not available in this build (see docs/arturia-schema.md). */
      completion: completion.nullable(),
      indicators: indicators.nullable(),
      qualitative: qualitative.nullable(),
      goals: goals.nullable(),
      /** Per-person rows: only in the named (non anonymized) report. */
      people: z.array(person).nullable(),
    }),
  })
  .refine((r) => !r.anonymized || r.sections.people === null, {
    message: "An anonymized report has no people section",
    path: ["sections", "people"],
  });

export type ArturiaReport = z.infer<typeof arturiaReportV1>;
export type ArturiaSections = ArturiaReport["sections"];
export type ExecutiveSection = z.infer<typeof executive>;
export type CompletionSection = z.infer<typeof completion>;
export type IndicatorsSection = z.infer<typeof indicators>;
export type QualitativeSection = z.infer<typeof qualitative>;
export type GoalsSection = z.infer<typeof goals>;
export type PersonRow = z.infer<typeof person>;
