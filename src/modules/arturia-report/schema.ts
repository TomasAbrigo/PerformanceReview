// Drizzle- and server-free: the versioned contract of the Arturía export.
// Field by field documentation: docs/arturia-schema.md.
import { z } from "zod";

export const SCHEMA_VERSION = "arturia-report.v1";
/** Bumped on every additive change of v1 (new optional field / section). */
export const SCHEMA_MINOR = 5;

const int = z.number().int().nonnegative();
const counts = z.array(int);

/** One group of an aggregate series; `other` marks the folded "Otros" cell. */
const group = z.object({
  label: z.string(),
  n: int,
  other: z.boolean(),
});

/**
 * Comments per sentiment. `neutral` and `mixed` came with minor 2 (before it
 * a report had three sentiments): a report without them reads as zero.
 */
const sentimentCounts = z.object({
  positive: int,
  constructive: int,
  neutral: int.default(0),
  mixed: int.default(0),
  negative: int,
  total: int,
});

const executive = z.object({
  participants: int,
  /**
   * Sides of the assessment that applied to someone: `self` and `manager`
   * from the completion module (`total` = participants it applies to,
   * `submitted` = who submitted: the same figures as `completion`, so the
   * participants without a request count as pending), then any other
   * relationship that has requests (`peer`, `upward`: requests that exist).
   */
  progress: z.array(
    z.object({ relationship: z.string(), total: int, submitted: int }),
  ),
  bins: z.array(z.object({ from: z.number(), to: z.number() })),
  /**
   * People per rating range. null when it cannot be published: the cycle has
   * no final ratings (`distributionStatus` `no_data`), or it is anonymized and
   * a group, or all the ratings, are under the minimum (`suppressed`: no
   * differencing).
   */
  distribution: counts.nullable(),
  /**
   * Why `distribution` is or is not there: `ok`, `no_data` (nobody has a
   * final rating: not a distribution of zeros) or `suppressed` (under the
   * minimum). Minor 5; a report of an earlier minor has none.
   */
  distributionStatus: z.enum(["ok", "no_data", "suppressed"]).optional(),
  byDepartment: z.array(group.extend({ mean: z.number().nullable(), counts })),
  /** People left out of the breakdown (their groups, Otros included, are under the minimum). */
  suppressed: int,
});

/**
 * One side (`self` or `manager`) of the assessment of a group: `n` is the
 * group's participants, `total` those the side applies to and `submitted`
 * the ones who submitted it. `applicable` is false (and `total` 0) when the
 * side applies to nobody in the group: there is nothing to complete.
 */
const completionRow = group.extend({
  relationship: z.string(),
  total: int,
  submitted: int,
  applicable: z.boolean(),
});
/** Percentage points against the previous cycle; null without a rate to compare. */
const points = z.number().nullable();
/** One side of the assessment of a whole cut (no draft / declined: the module does not tell them). */
const sideTotal = z.object({
  relationship: z.string(),
  total: int,
  submitted: int,
  applicable: z.boolean(),
});
const completion = z.object({
  /** Participants of the cycle (the head count, shown even when groups are not). */
  participants: int,
  /**
   * `self` and `manager` always (`applicable` false when it applies to
   * nobody); null when anonymized and any group is suppressed (no
   * differencing). `draft` and `declined` are always null: the completion
   * figures count submitted against applicable sides and do not tell drafts
   * from the rest.
   */
  byRelationship: z
    .array(
      z.object({
        relationship: z.string(),
        total: int,
        submitted: int,
        applicable: z.boolean(),
        draft: int.nullable(),
        declined: int.nullable(),
      }),
    )
    .nullable(),
  byDepartment: z.array(completionRow),
  byManager: z.array(completionRow),
  /**
   * The same cut by org attribute (account; DM: "DM N" when anonymized, a
   * person's team). Minor 3: absent in a report of an earlier minor.
   */
  byAccount: z.array(completionRow).optional(),
  byDm: z.array(completionRow).optional(),
  /**
   * The totals of those cuts (`self` and `manager`, as `byRelationship`):
   * null when anonymized and any group of that cut is suppressed (no
   * differencing within the cut). They never hide the totals above, which
   * only the area and team cuts decide.
   */
  byAccountTotal: z.array(sideTotal).nullable().optional(),
  byDmTotal: z.array(sideTotal).nullable().optional(),
  /** Participants left out of each breakdown. */
  suppressed: z.object({
    byDepartment: int,
    byManager: int,
    byAccount: int.optional(),
    byDm: int.optional(),
  }),
  /** The semester before, per area; null when there is none. */
  delta: z
    .object({
      previousCycleName: z.string(),
      /** null when anonymized and any group is suppressed. */
      total: z.object({ self: points, manager: points }).nullable(),
      byDepartment: z.array(
        z.object({
          label: z.string(),
          other: z.boolean(),
          self: points,
          manager: points,
        }),
      ),
    })
    .nullable(),
});

const band = z.enum(["low", "mid", "high"]);
const indicatorGroup = group.extend({ mean: z.number().nullable(), counts });
const indicatorTotal = z.object({
  n: int,
  mean: z.number().nullable(),
  counts,
});
const indicators = z.object({
  distribution: z.array(
    z.object({
      indicator: z.string(),
      groups: z.array(indicatorGroup),
      /** Minor 3: the same distribution by account and by DM ("DM N" when anonymized). */
      byAccount: z.array(indicatorGroup).optional(),
      byDm: z.array(indicatorGroup).optional(),
      /**
       * Everybody of that cut together; null when anonymized and any of its
       * groups is suppressed. Never hides `total`, which only the area cut decides.
       */
      byAccountTotal: indicatorTotal.nullable().optional(),
      byDmTotal: indicatorTotal.nullable().optional(),
      /** People left out of `byAccount` / `byDm` (groups under the minimum). */
      suppressedBy: z.object({ account: int, dm: int }).optional(),
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

const sentimentRow = sentimentCounts.extend({
  dimension: z.string(),
  other: z.boolean(),
});
const themeRow = z.object({
  theme: z.string(),
  count: int,
  other: z.boolean(),
  /** Sentiment of the theme's comments (minor 2; `total` = `count`). */
  sentiment: sentimentCounts.optional(),
  quotes: z.array(z.string()),
});

/** Sentiment and themes of the comments one side wrote (minor 2). */
const qualitativeSide = z.object({
  /** null when anonymized and some group was suppressed (no differencing). */
  totals: sentimentCounts.nullable(),
  sentimentByDimension: z.array(sentimentRow),
  topThemes: z.array(themeRow),
  suppressed: int,
});

const qualitative = z.object({
  /** Everything in the cycle, all sides (minor 2); null as `qualitativeSide.totals`. */
  totals: sentimentCounts.nullable().optional(),
  sentimentByDimension: z.array(sentimentRow),
  trend: z.array(
    sentimentCounts.extend({
      cycleId: z.string(),
      cycleName: z.string(),
      periodEnd: z.string(),
    }),
  ),
  topThemes: z.array(themeRow),
  suppressed: int,
  /**
   * The same cut by who wrote the comments (review relationship `self` or
   * `manager`, as People's Propios / Manager toggle); null: that side has no
   * labeled comments. Minor 2.
   */
  bySide: z
    .object({
      self: qualitativeSide.nullable(),
      manager: qualitativeSide.nullable(),
    })
    .optional(),
});

/** The goal figures of a group; `n` is its people (cycle participants). */
const goalRow = group.extend({
  peopleWithGoals: int,
  goals: int,
  completed: int,
  /** In progress and not overdue: the four counts below add up to `goals`. */
  inProgress: int,
  closed: int,
  /** In progress and due before `goals.asOf`. */
  overdue: int,
  /** Mean progress of the goals, 0-100. */
  avgProgress: z.number().nullable(),
});
/** A person whose goals and indicators disagree (named report only). */
const goalOutlier = z.object({
  personId: z.string(),
  name: z.string(),
  department: z.string().nullable(),
  manager: z.string().nullable(),
  goals: int,
  completed: int,
  completedPct: z.number(),
  /** 1-5 as the manager answered; null when not answered. */
  retention: z.number().nullable(),
  engagement: z.number().nullable(),
});
const outlierGroup = z.object({
  /** null when anonymized and fewer people than the minimum. */
  count: int.nullable(),
  /** Empty when anonymized (the schema requires it). */
  people: z.array(goalOutlier),
});
const goalTotal = z.object({
  participantsWithGoals: int,
  goals: int,
  completed: int,
  avgProgress: z.number().nullable(),
});
const goals = z.object({
  /**
   * The reference date (YYYY-MM-DD) `overdue` is measured at: the day the
   * report is generated while the cycle's period runs, the end of the period
   * once the cycle is closed (the goals' snapshot is frozen there). Minor 5.
   */
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /**
   * The four totals are null when anonymized and any breakdown (areas,
   * teams, buckets) has a suppressed group (no differencing).
   */
  participantsWithGoals: int.nullable(),
  goals: int.nullable(),
  completed: int.nullable(),
  avgProgress: z.number().nullable(),
  byDepartment: z.array(goalRow),
  byManager: z.array(goalRow),
  /** Minor 3: the same by account and by DM ("DM N" when anonymized). */
  byAccount: z.array(goalRow).optional(),
  byDm: z.array(goalRow).optional(),
  /** Everybody of that cut together; null when anonymized and any of its groups is suppressed. Never hides the four totals above. */
  byAccountTotal: goalTotal.nullable().optional(),
  byDmTotal: goalTotal.nullable().optional(),
  /** Slices of the share of goals completed (`from`-`to`, 0-100) with the indicators of their people. */
  buckets: z.array(
    z.object({
      from: z.number(),
      to: z.number(),
      /** null when anonymized and the bucket is under the minimum. */
      people: int.nullable(),
      meanRetention: z.number().nullable(),
      meanEngagement: z.number().nullable(),
      meanPositiveShare: z.number().nullable(),
      hidden: z.boolean(),
    }),
  ),
  /** People without goals in the period; null when anonymized. */
  withoutGoals: int.nullable(),
  outliers: z.object({
    thresholds: z.object({
      /** Share (%) of completed goals that counts as done / behind. */
      goalsHigh: z.number(),
      goalsLow: z.number(),
      /** Retention or engagement at or under this is low. */
      riskThreshold: z.number(),
      /** Both indicators at or above this are high. */
      indicatorHigh: z.number(),
    }),
    /** Goals done but retention or engagement low. */
    doneButLow: outlierGroup,
    /** Goals behind but both indicators high. */
    behindButHigh: outlierGroup,
  }),
  /** People left out of each breakdown (their groups are under the minimum). */
  suppressed: z.object({
    byDepartment: int,
    byManager: int,
    byAccount: int.optional(),
    byDm: int.optional(),
    buckets: int,
  }),
});

/**
 * One month of the monthly engagement file (minor 4). Anonymized, a month
 * under the minimum group size is `hidden` and carries no number, and the
 * cells that would give a small group away are null (see
 * docs/engagement-monthly.md).
 */
const engagementMonth = z.object({
  /** `YYYY-MM`. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  hidden: z.boolean(),
  /** People with a row that month; null when hidden. */
  people: int.nullable(),
  /** People who answered (any segment but `falta`). */
  respondents: int.nullable(),
  /** Share of the people who answered, 0-1. */
  participation: z.number().min(0).max(1).nullable(),
  /** Mean score of those with one, 0-1. */
  meanScore: z.number().min(0).max(1).nullable(),
  segments: z
    .object({ alto: int, medio: int, regular: int, bajo: int, falta: int })
    .nullable(),
});
const engagementMonthly = z.object({
  /** The months of the cycle's period that have data, oldest first. */
  months: z.array(engagementMonth),
  /** Months left without numbers because they are under the minimum. */
  suppressedMonths: int,
});

/**
 * Where a side of the assessment stands, as the completion module says it
 * (`submitted`, `in_progress`, `not_started`, `not_applicable`): never null
 * for a participant, so a pending assessment is told from a submitted one.
 */
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
      /**
       * The monthly engagement of the months of the cycle's period (minor 4);
       * null when the period has no engagement data, absent before minor 4.
       */
      engagementMonthly: engagementMonthly.nullable().optional(),
      /** Per-person rows: only in the named (non anonymized) report. */
      people: z.array(person).nullable(),
    }),
  })
  .refine((r) => !r.anonymized || r.sections.people === null, {
    message: "An anonymized report has no people section",
    path: ["sections", "people"],
  })
  .refine(
    (r) =>
      !r.anonymized ||
      !r.sections.goals ||
      [
        r.sections.goals.outliers.doneButLow,
        r.sections.goals.outliers.behindButHigh,
      ].every((o) => o.people.length === 0),
    {
      message: "An anonymized report names nobody among the goal outliers",
      path: ["sections", "goals", "outliers"],
    },
  );

export type ArturiaReport = z.infer<typeof arturiaReportV1>;
export type ArturiaSections = ArturiaReport["sections"];
export type ExecutiveSection = z.infer<typeof executive>;
export type CompletionSection = z.infer<typeof completion>;
export type IndicatorsSection = z.infer<typeof indicators>;
export type QualitativeSection = z.infer<typeof qualitative>;
export type QualitativeSideSection = z.infer<typeof qualitativeSide>;
export type GoalsSection = z.infer<typeof goals>;
export type EngagementMonthlySection = z.infer<typeof engagementMonthly>;
export type PersonRow = z.infer<typeof person>;
