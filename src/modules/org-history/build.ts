/**
 * Pure SCD2 builders for Bamboo history tables (jobInfo, employmentStatus).
 * Intervals are half-open: [validFrom, validTo), validTo null = still open.
 */

export type JobRow = {
  /** Bamboo table row id. */
  sourceId: string;
  date: string | null;
  location: string | null;
  department: string | null;
  division: string | null;
  jobTitle: string | null;
  /** Manager as Bamboo shows it in jobInfo: a display NAME, not an id. */
  reportsTo: string | null;
};

export type BuiltJobRow = {
  sourceId: string;
  validFrom: string;
  validTo: string | null;
  managerRaw: string | null;
  department: string | null;
  division: string | null;
  jobTitle: string | null;
  location: string | null;
};

export type StatusRow = {
  sourceId: string;
  date: string | null;
  status: string | null;
  comment: string | null;
};

export type BuiltStatusRow = {
  sourceId: string;
  validFrom: string;
  validTo: string | null;
  employmentStatus: string | null;
  comment: string | null;
};

const byDateThenId = <T extends { date: string | null; sourceId: string }>(
  a: T,
  b: T,
) =>
  a.date!.localeCompare(b.date!) ||
  Number(a.sourceId) - Number(b.sourceId) ||
  a.sourceId.localeCompare(b.sourceId);

/** Dated rows sorted; of several rows on one day only the last (by id) wins. */
function lastPerDay<T extends { date: string | null; sourceId: string }>(
  rows: T[],
): (T & { date: string })[] {
  const sorted = rows.filter((r) => r.date).sort(byDateThenId);
  return sorted.filter((r, i) => sorted[i + 1]?.date !== r.date) as (T & {
    date: string;
  })[];
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const sameJob = (a: JobRow, b: JobRow) =>
  a.reportsTo === b.reportsTo &&
  a.department === b.department &&
  a.division === b.division &&
  a.jobTitle === b.jobTitle &&
  a.location === b.location;

/**
 * jobInfo rows of ONE employee → SCD2 rows: one per change, validTo = next
 * row's date, last row open unless a termination (date of the
 * "Terminated" status) falls inside it, which closes it the day after.
 */
export function buildJobHistory(
  rows: JobRow[],
  terminations: string[],
): BuiltJobRow[] {
  const changes = lastPerDay(rows).filter(
    (r, i, all) => i === 0 || !sameJob(all[i - 1], r),
  );
  return changes.map((r, i) => {
    const next = changes[i + 1]?.date ?? null;
    const term = terminations
      .filter((t) => t >= r.date && (next === null || t < next))
      .sort()[0];
    return {
      sourceId: r.sourceId,
      validFrom: r.date,
      validTo: term ? addDays(term, 1) : next,
      managerRaw: r.reportsTo,
      department: r.department,
      division: r.division,
      jobTitle: r.jobTitle,
      location: r.location,
    };
  });
}

/** employmentStatus rows of ONE employee → SCD2 rows. */
export function buildStatusHistory(rows: StatusRow[]): BuiltStatusRow[] {
  const changes = lastPerDay(rows);
  return changes.map((r, i) => ({
    sourceId: r.sourceId,
    validFrom: r.date,
    validTo: changes[i + 1]?.date ?? null,
    employmentStatus: r.status,
    comment: r.comment,
  }));
}

export const isTermination = (status: string | null) =>
  status?.trim().toLowerCase() === "terminated";
