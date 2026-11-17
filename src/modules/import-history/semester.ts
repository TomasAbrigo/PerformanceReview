import type { DbOrTx } from "@/db/client";
import { todayLocal } from "@/modules/org-history/dates";
import { getSettings } from "@/modules/settings";

/**
 * Semi-annual review cycles (PRD iteration 2): a report row with no cycle
 * name goes to the semester its date falls in. Where the halves start comes
 * from settings (#56: `semester.h1Start`, `semester.h2Start`,
 * `semester.ambiguityDays`); a date that close to a cutoff could belong to
 * either half (a review of H1 written in early July), so it is ambiguous and
 * someone has to choose.
 */
export type SemesterConfig = {
  /** "MM-DD" the first half starts on (its year names the semester). */
  h1Start: string;
  /** "MM-DD" the second half starts on. */
  h2Start: string;
  /** Days on either side of a cutoff in which a date is ambiguous. */
  ambiguityDays: number;
};

export const DEFAULT_SEMESTER_CONFIG: SemesterConfig = {
  h1Start: "01-01",
  h2Start: "07-01",
  ambiguityDays: 15,
};

/** The semester settings (`semester.*` in app settings, #56). */
export async function semesterConfig(db: DbOrTx): Promise<SemesterConfig> {
  const settings = await getSettings(db);
  return {
    h1Start: settings["semester.h1Start"],
    h2Start: settings["semester.h2Start"],
    ambiguityDays: settings["semester.ambiguityDays"],
  };
}

export type Semester = {
  year: number;
  half: 1 | 2;
  /** "2025-H1". */
  label: string;
  periodStart: string;
  periodEnd: string;
  ambiguous: boolean;
};

const DAY = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);
const on = (year: number, monthDay: string) => `${year}-${monthDay}`;

/** Start of half `half` of semester-year `year`, and of the next one. */
function bounds(year: number, half: 1 | 2, cfg: SemesterConfig) {
  // H2 belongs to the same semester-year as the H1 before it: with an April
  // start, H2 2024 runs October 2024 - March 2025.
  const h2Year = cfg.h2Start > cfg.h1Start ? year : year + 1;
  const start = half === 1 ? on(year, cfg.h1Start) : on(h2Year, cfg.h2Start);
  const next = half === 1 ? on(h2Year, cfg.h2Start) : on(year + 1, cfg.h1Start);
  return { start, next };
}

function locate(date: string, cfg: SemesterConfig) {
  const calendarYear = Number(date.slice(0, 4));
  for (const year of [calendarYear, calendarYear - 1]) {
    for (const half of [1, 2] as const) {
      const { start, next } = bounds(year, half, cfg);
      if (date >= start && date < next) return { year, half, start, next };
    }
  }
  throw new Error(`No semester contains ${date}`);
}

export function semesterOf(date: string, cfg: SemesterConfig): Semester {
  const { year, half, start, next } = locate(date, cfg);
  const t = toTime(date);
  const margin = cfg.ambiguityDays * DAY;
  return {
    year,
    half,
    label: `${year}-H${half}`,
    periodStart: start,
    periodEnd: toDate(toTime(next) - DAY),
    ambiguous: t - toTime(start) < margin || toTime(next) - t <= margin,
  };
}

const LABEL = /(\d{4})-H([12])\b/;

/** The period of a semester label ("2024-H2", or a name containing one). */
export function semesterPeriod(
  label: string,
  cfg: SemesterConfig,
): { periodStart: string; periodEnd: string } | null {
  const match = LABEL.exec(label);
  if (!match) return null;
  const { start, next } = bounds(
    Number(match[1]),
    Number(match[2]) as 1 | 2,
    cfg,
  );
  return { periodStart: start, periodEnd: toDate(toTime(next) - DAY) };
}

/**
 * The semester a period lies in, when both its ends fall in the same one:
 * an imported cycle's period (min/max of its assessment dates) widened to it.
 */
export function snapToSemester(
  period: { periodStart: string; periodEnd: string },
  cfg: SemesterConfig,
): { periodStart: string; periodEnd: string } | null {
  const a = semesterOf(period.periodStart, cfg);
  const b = semesterOf(period.periodEnd, cfg);
  if (a.label !== b.label) return null;
  return { periodStart: a.periodStart, periodEnd: a.periodEnd };
}

/** A cycle source id that is a bare semester label ("2025-H1"). */
export const isSemesterLabel = (sourceId: string | null) =>
  sourceId !== null && /^\d{4}-H[12]$/.test(sourceId);

/**
 * The snapshot date of a semester cycle: its end, or today while the
 * semester is not over (a snapshot is never taken as of a future date).
 */
export function snapshotDateFor(periodEnd: string, today = todayLocal()) {
  return periodEnd < today ? periodEnd : today;
}
