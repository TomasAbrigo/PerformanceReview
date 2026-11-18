// Pure: masks the counts of a month the way each reader may see them.
import { engagementSegments } from "@/modules/engagement/kinds";
import type { EngagementMonth, MonthCounts, SegmentCounts } from "./types";

export const emptySegments = (): SegmentCounts =>
  Object.fromEntries(engagementSegments.map((s) => [s, 0])) as SegmentCounts;

/** A month as People (and a manager, for their reports) read it: everything. */
export function openMonth(m: MonthCounts): EngagementMonth {
  return {
    month: m.month,
    hidden: false,
    people: m.people,
    respondents: m.respondents,
    participation: m.people > 0 ? m.respondents / m.people : null,
    mean: m.mean,
    segments: m.segments,
  };
}

/**
 * A month as direction reads it (see `EngagementMonth`): hidden when under
 * `min` people or scores; otherwise participation only if it does not give
 * away a small cell, and the segments only if no non-empty one is under `min`.
 */
export function maskedMonth(m: MonthCounts, min: number): EngagementMonth {
  if (m.people < min || m.scored < min) {
    return {
      month: m.month,
      hidden: true,
      people: null,
      respondents: null,
      participation: null,
      mean: null,
      segments: null,
    };
  }
  const falta = m.segments.falta;
  const participationSafe =
    m.respondents >= min && (falta === 0 || falta >= min);
  const segmentsSafe = engagementSegments.every(
    (s) => m.segments[s] === 0 || m.segments[s] >= min,
  );
  return {
    month: m.month,
    hidden: false,
    people: m.people,
    respondents: participationSafe ? m.respondents : null,
    participation: participationSafe ? m.respondents / m.people : null,
    mean: m.mean,
    segments: segmentsSafe ? m.segments : null,
  };
}

/** The evolution of `rows` (ascending months) for a reader: `min` null reads everything. */
export function buildMonths(
  rows: readonly MonthCounts[],
  min: number | null,
): { months: EngagementMonth[]; hiddenMonths: number } {
  const months = rows.map((r) =>
    min === null ? openMonth(r) : maskedMonth(r, min),
  );
  return { months, hiddenMonths: months.filter((m) => m.hidden).length };
}
