import type { DbOrTx } from "@/db/client";
import type { LocalizedText } from "@/db/schema";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
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
  // Bamboo's real cadence (PRD iteration 3): ~29/3 - 28/9 and ~29/9 - 28/3.
  h1Start: "03-29",
  h2Start: "09-29",
  ambiguityDays: 15,
};

/**
 * Legacy reports (rows without a cycle name, iteration 2): calendar halves,
 * as they were imported before #83, so re-imports keep their cycles. Only
 * the margin comes from settings.
 */
export const LEGACY_SEMESTER_CUTOFFS = { h1Start: "01-01", h2Start: "07-01" };

export async function legacySemesterConfig(
  db: DbOrTx,
): Promise<SemesterConfig> {
  const settings = await getSettings(db);
  return {
    ...LEGACY_SEMESTER_CUTOFFS,
    ambiguityDays: settings["semester.ambiguityDays"],
  };
}

/**
 * The semester settings (`semester.*` in app settings, #56): the review
 * periods of Bamboo's real reports (#83).
 */
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

/**
 * The end of a review period that starts on `start` (Bamboo's raw report
 * only gives the start): the day before the next semester cutoff after it.
 * Irregular historical starts end on the cutoff after them as well.
 */
export function periodEndFor(start: string, cfg: SemesterConfig): string {
  const year = Number(start.slice(0, 4));
  const cutoffs = [year, year + 1, year + 2]
    .flatMap((y) => [on(y, cfg.h1Start), on(y, cfg.h2Start)])
    .filter((cutoff) => cutoff > start)
    .sort();
  // A start within the ambiguity margin before a cutoff opens the semester
  // that starts at that cutoff (an early launch): it ends at the next one.
  const early = toTime(cutoffs[0]) - toTime(start) <= cfg.ambiguityDays * DAY;
  return toDate(toTime(cutoffs[early ? 1 : 0]) - DAY);
}

/**
 * The name of a review period's cycle per language, from the message
 * `ImportHistory.periodCycleName` ("Evaluación semestral 2024-03-29 –
 * 2024-09-28" / "Semi-annual review ...").
 */
export function periodCycleNames(start: string, end: string): LocalizedText {
  const fill = (template: string) =>
    template.replace("{start}", start).replace("{end}", end);
  return {
    es: fill(es.ImportHistory.periodCycleName),
    en: fill(en.ImportHistory.periodCycleName),
  };
}

/** The Spanish name (`review_cycle.name`). */
export const periodCycleName = (start: string, end: string) =>
  periodCycleNames(start, end).es;

/** Source id of the imported cycle of a review period (by its start). */
export const periodSourceId = (start: string) => `period:${start}`;
