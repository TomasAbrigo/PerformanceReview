// Drizzle- and server-free: shared by the queries and client components.
import type { LocalizedText } from "@/db/schema/rating-scales";
import type { Relationship } from "@/modules/templates/constants";

/** Org hierarchy a dashboard reads: frozen at the cycle snapshot, or today's. */
export const hierarchies = ["asOf", "current"] as const;
export type Hierarchy = (typeof hierarchies)[number];

export const groupBys = ["department", "manager", "location", "jobTitle"] as const;
export type GroupBy = (typeof groupBys)[number];

export const ratingStages = ["manager", "current"] as const;
export type RatingStage = (typeof ratingStages)[number];

export type DashboardFilters = {
  cycleId?: string;
  hierarchy: Hierarchy;
  department?: string;
  managerId?: string;
  location?: string;
  jobTitle?: string;
  /** Executive view: no person names or ids in the result. */
  aggregateOnly?: boolean;
};

/** Bins of the normalized (0-1) rating, so cycles with different scales compare. */
export const BIN_COUNT = 5;
export const binOf = (normalized: number) =>
  Math.min(BIN_COUNT - 1, Math.floor(normalized * BIN_COUNT));
export const bins = Array.from({ length: BIN_COUNT }, (_, i) => ({
  from: i / BIN_COUNT,
  to: (i + 1) / BIN_COUNT,
}));

/** Groups smaller than this are folded away in the executive view. */
export const MIN_GROUP = 3;

export type ProgressCounts = {
  total: number;
  submitted: number;
  draft: number;
  declined: number;
};
export type CycleProgress = {
  cycleId: string;
  status: string;
  rows: (ProgressCounts & {
    relationship: Relationship;
    department: string | null;
    managerId: string | null;
    managerName: string | null;
  })[];
  totals: (ProgressCounts & { relationship: Relationship })[];
};

export type DistributionSeries = {
  key: string | null;
  label: string | null;
  counts: number[];
  n: number;
  mean: number | null;
};
export type RatingDistribution = {
  bins: { from: number; to: number }[];
  series: DistributionSeries[];
  total: number[];
};

export type TrajectoryPoint = {
  cycleId: string;
  cycleName: string;
  periodEnd: string;
  normalized: number | null;
  optionLabel: string | null;
  stage: string | null;
  managerName: string | null;
  jobTitle: string | null;
  department: string | null;
};
export type PersonTrajectory = {
  personId: string;
  personName: string;
  points: TrajectoryPoint[];
};

export type TeamMember = {
  personId: string;
  name: string;
  depth: number;
  jobTitle: string | null;
  department: string | null;
  participantId: string | null;
  normalized: number | null;
};
export type ManagerTeam = {
  managerId: string;
  hierarchy: Hierarchy;
  members: TeamMember[];
};

export type GoalsVsRatingRow = {
  participantId: string;
  personId: string;
  name: string;
  goals: number;
  completed: number;
  avgProgress: number | null;
  normalized: number | null;
};

export type GapByQuestion = {
  questionRevisionId: string;
  prompt: LocalizedText;
  n: number;
  meanSelf: number;
  meanManager: number;
  meanGap: number;
};
export type GapByPerson = {
  participantId: string;
  personId: string;
  name: string;
  n: number;
  meanGap: number;
};
export type SelfManagerGap = {
  byQuestion: GapByQuestion[];
  byPerson: GapByPerson[];
};

export type ExecutiveSummary = {
  participants: number;
  progress: { relationship: Relationship; total: number; submitted: number }[];
  distribution: number[];
  byDepartment: {
    department: string;
    n: number;
    mean: number | null;
    counts: number[];
  }[];
  /** People in groups smaller than MIN_GROUP (not shown per department). */
  suppressed: number;
};
