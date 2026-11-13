import type { FixtureJobRow } from "./types";

/** jobInfo rows grouped by employee, each list sorted by date. */
export function groupJobRows(
  jobHistory: readonly FixtureJobRow[],
): Map<string, FixtureJobRow[]> {
  const byEmployee = new Map<string, FixtureJobRow[]>();
  for (const row of jobHistory) {
    const rows = byEmployee.get(row.employeeId);
    if (rows) rows.push(row);
    else byEmployee.set(row.employeeId, [row]);
  }
  for (const rows of byEmployee.values()) {
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  return byEmployee;
}

/** jobInfo row in force for `employeeId` on `date` (last one on or before it). */
export function rowOnDate(
  rowsByEmployee: ReadonlyMap<string, readonly FixtureJobRow[]>,
  employeeId: string,
  date: string,
): FixtureJobRow | null {
  const rows = rowsByEmployee.get(employeeId) ?? [];
  let found: FixtureJobRow | null = null;
  for (const row of rows) {
    if (row.date <= date) found = row;
  }
  return found;
}

/** Consecutive jobInfo rows of one employee whose manager differs. */
export function countManagerChanges(
  rowsByEmployee: ReadonlyMap<string, readonly FixtureJobRow[]>,
): number {
  let changes = 0;
  for (const rows of rowsByEmployee.values()) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].managerId !== rows[i - 1].managerId) changes++;
    }
  }
  return changes;
}
