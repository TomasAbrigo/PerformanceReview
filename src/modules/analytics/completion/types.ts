// Drizzle- and server-free: shared by the queries and client components.
import type { ProgressStatus } from "@/db/schema/import-history";
import type { Hierarchy } from "@/modules/analytics/dashboards/types";

export type { Hierarchy };

/** How the summary splits the participants of a cycle. */
export const completionGroupBys = ["none", "department", "manager"] as const;
export type CompletionGroupBy = (typeof completionGroupBys)[number];

/** Which side of an assessment is missing, for the "quién falta" list. */
export const missingStatuses = [
  "any",
  "self_missing",
  "manager_missing",
] as const;
export type MissingStatus = (typeof missingStatuses)[number];

/**
 * Where one side of an assessment stands: Bamboo's Assessment Progress
 * statuses. `not_applicable` sides (no such assessment in the cycle) count
 * neither as submitted nor as missing, and stay out of the percentages.
 */
export const sideStatuses = [
  "not_started",
  "in_progress",
  "submitted",
  "not_applicable",
] as const satisfies readonly ProgressStatus[];
export type SideStatus = ProgressStatus;

/** A side is missing when it applies and has not been submitted. */
export const isMissing = (status: SideStatus) =>
  status === "not_started" || status === "in_progress";

/** Where a participant's statuses came from. */
export type CompletionSource = "progress" | "requests";

/** submitted / applicable, 0-1; null when the side applies to nobody. */
export const rateOf = (submitted: number, applicable: number) =>
  applicable > 0 ? submitted / applicable : null;

/** The counts of a group of participants (the rates follow from them). */
export type CompletionCounts = {
  participants: number;
  selfSubmitted: number;
  selfApplicable: number;
  managerSubmitted: number;
  managerApplicable: number;
};

export type CompletionGroup = CompletionCounts & {
  /** Department name or manager person id; null: nobody / unassigned / all. */
  key: string | null;
  label: string | null;
  selfRate: number | null;
  managerRate: number | null;
};

export const withRates = (
  key: string | null,
  label: string | null,
  c: CompletionCounts,
): CompletionGroup => ({
  ...c,
  key,
  label,
  selfRate: rateOf(c.selfSubmitted, c.selfApplicable),
  managerRate: rateOf(c.managerSubmitted, c.managerApplicable),
});

export type CompletionSummary = {
  cycleId: string;
  cycleName: string;
  /** The grouping actually applied (direction never gets managers). */
  groupBy: CompletionGroupBy;
  hierarchy: Hierarchy;
  /**
   * The smallest group the viewer may see (direction: the
   * `aggregation.minGroupSize` setting); null when nothing is masked.
   */
  minGroupSize: number | null;
  /** Everybody in scope; the head count is shown even under the minimum. */
  participants: number;
  /** All of them together; null when masked because there are too few. */
  total: CompletionGroup | null;
  groups: CompletionGroup[];
  /**
   * Direction only: groups under the minimum (and the unassigned one)
   * together, "Otros"; null when empty or still under the minimum.
   */
  others: CompletionGroup | null;
  /** People left out of the breakdown: their groups, and "Otros", are under the minimum. */
  suppressed: number;
  /** Participants whose statuses came from each source. */
  sources: Record<CompletionSource, number>;
};

/** Percentage points; null when either cycle has no rate to compare. */
export type CompletionDeltaRow = {
  key: string | null;
  label: string | null;
  selfDelta: number | null;
  managerDelta: number | null;
};

export type CompletionDelta = {
  current: CompletionSummary;
  /** The earlier semester cycle; null when there is none. */
  previous: CompletionSummary | null;
  total: Pick<CompletionDeltaRow, "selfDelta" | "managerDelta"> | null;
  /** One per group of `current.groups`, in the same order. */
  groups: CompletionDeltaRow[];
  others: CompletionDeltaRow | null;
};

export type MissingPerson = {
  cycleName: string;
  personId: string;
  participantId: string;
  name: string;
  department: string | null;
  managerId: string | null;
  managerName: string | null;
  selfStatus: SideStatus;
  managerStatus: SideStatus;
  /** The Assessment Progress report carries follow-up notes for them. */
  hasFollowUpNotes: boolean;
  source: CompletionSource;
  /** Only when asked for by People (`includeEmail`). */
  email?: string | null;
};

export type CompletionCycle = {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: string;
};

/** A fraction (a rate, or a difference of rates) as percentage points, one decimal. */
export const roundedPoints = (fraction: number) =>
  Math.round(fraction * 1000) / 10;

/** Percentage points between two rates (0-1), one decimal. */
export const deltaPoints = (current: number | null, previous: number | null) =>
  current === null || previous === null
    ? null
    : roundedPoints(current - previous);
