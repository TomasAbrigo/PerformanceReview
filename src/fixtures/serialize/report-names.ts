import type { CompanyFixture, FixtureEmployee } from "../company";

const fullName = (e: Pick<FixtureEmployee, "firstName" | "lastName">): string =>
  `${e.firstName} ${e.lastName}`;

/**
 * Names as the CSV reports print them ("First Last", no ids).
 *
 * - A report row carries the name the person had when the cycle ran, so
 *   people renamed later appear under their previous name in older cycles.
 * - A few names are mistyped in one cycle's report (ground truth in
 *   `company.identity.misspellings`).
 * - Manager columns and the Goal Status snapshot use the current name.
 */
export function createReportNamer(company: CompanyFixture) {
  const byId = new Map(company.employees.map((e) => [e.id, e]));
  const renames = new Map(company.identity.renames.map((r) => [r.employeeId, r]));
  const typos = new Map(
    company.identity.misspellings.map((m) => [`${m.employeeId}:${m.cycle}`, m.csvName]),
  );

  const current = (employeeId: string): string => fullName(byId.get(employeeId)!);

  return {
    current,
    inCycle(employeeId: string, cycleIndex: number): string {
      const typo = typos.get(`${employeeId}:${cycleIndex}`);
      if (typo !== undefined) return typo;
      const rename = renames.get(employeeId);
      if (rename && company.cycles[cycleIndex].assessmentDue < rename.renamedOn) {
        return `${rename.previousFirstName} ${rename.previousLastName}`;
      }
      return current(employeeId);
    },
  };
}
