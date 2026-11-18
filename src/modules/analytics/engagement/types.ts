// Drizzle- and server-free: shared by the queries and client components.
import type {
  EngagementSegment,
  scoredSegments,
} from "@/modules/engagement/kinds";
import type { OrgFilters, OrgOptions } from "@/modules/org-attributes/kinds";

export type { EngagementSegment };

/**
 * What the monthly engagement views narrow by: a range of months (first of
 * month, ISO, both included; default the last 12 months with data), the
 * person's area, location, title and manager as of each month, and the org
 * attributes People keep (account, project, DM, Santex Lead) as of the end of
 * each month.
 */
export type EngagementFilters = OrgFilters & {
  from?: string;
  to?: string;
  department?: string;
  location?: string;
  jobTitle?: string;
  managerId?: string;
  /** Direction's minimum group size; default: the `aggregation.minGroupSize` setting. */
  minGroupSize?: number;
};

/** People per segment (the four score cuts and `falta`). */
export type SegmentCounts = Record<EngagementSegment, number>;
export type ScoredSegment = (typeof scoredSegments)[number];

/** One month of the evolution, as the query counted it (before masking). */
export type MonthCounts = {
  /** First day of the month, ISO. */
  month: string;
  /** People with a row that month (answered or not). */
  people: number;
  /** People who answered (any segment but `falta`). */
  respondents: number;
  /** People with a score. */
  scored: number;
  /** Mean score (0-1) of those with one. */
  mean: number | null;
  segments: SegmentCounts;
};

/**
 * One month as a viewer may read it. Direction gets aggregates only: a month
 * with fewer people (or scores) than the minimum shows nothing but its
 * month (`hidden`); `participation` is left out when it would give away a
 * small cell (fewer than the minimum answers, or a "falta" cell under it);
 * `segments` is null when any non-empty segment cell is under the minimum.
 */
export type EngagementMonth = {
  month: string;
  hidden: boolean;
  people: number | null;
  respondents: number | null;
  /** Share of the people of the month who answered, 0-1. */
  participation: number | null;
  mean: number | null;
  segments: SegmentCounts | null;
};

export type EngagementEvolution = {
  /** Months with data in the range, oldest first. */
  months: EngagementMonth[];
  from: string | null;
  to: string | null;
  /** The minimum group size applied (direction), else null. */
  minGroupSize: number | null;
  /** Months left out of the numbers because they are under the minimum. */
  hiddenMonths: number;
};

/** The executive tile: the latest month with data, next to the one before. */
export type EngagementTile = {
  latest: EngagementMonth;
  previous: EngagementMonth | null;
  minGroupSize: number | null;
};

/** The values of the filter selects of the engagement view. */
export type EngagementFilterOptions = {
  org: OrgOptions;
  departments: string[];
  /** First and last month with data (what the range can be set to); null: no data. */
  firstMonth: string | null;
  lastMonth: string | null;
};
