/**
 * Ground truth of the seeded database. e2e/global-setup.ts seeds the small
 * generated company (`pnpm db:seed --size small`), so the specs derive what
 * they expect from the same generator instead of hard-coding names and counts:
 * regenerating the fixtures does not break them.
 */
import { generateCompany } from "../src/fixtures/company";
import type { FixtureEmployee, FixtureGoal } from "../src/fixtures/company";
import { FIXTURE_SEEDS } from "../src/fixtures/write";

export const company = generateCompany({
  size: "small",
  seed: FIXTURE_SEEDS.small,
});

export const employees = company.employees;

/** Display name the app shows (first name + last name). */
export const fullName = (e: Pick<FixtureEmployee, "firstName" | "lastName">) =>
  `${e.firstName} ${e.lastName}`;

const nameCount = new Map<string, number>();
for (const e of employees) {
  nameCount.set(fullName(e), (nameCount.get(fullName(e)) ?? 0) + 1);
}

/**
 * Rehires and namesakes share a name, which a link cannot tell apart: specs
 * that navigate by name pick people whose name is unique.
 */
export const hasUniqueName = (e: FixtureEmployee) =>
  nameCount.get(fullName(e)) === 1;

export const isActive = (e: FixtureEmployee) => e.status === "Active";

export const byId = new Map(employees.map((e) => [e.id, e]));

/** Goals of an employee, as the app orders them (by due date; dates are distinct per owner). */
export function goalsOf(e: FixtureEmployee): FixtureGoal[] {
  return company.goals
    .filter((g) => g.employeeId === e.id)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Active employees whose manager is `manager` (a direct report today). */
export const directReports = (manager: FixtureEmployee) =>
  employees.filter((e) => isActive(e) && e.managerId === manager.id);

/** Job history rows of an employee (the app stores them one to one here). */
export const jobRowsOf = (e: FixtureEmployee) =>
  company.jobHistory.filter((r) => r.employeeId === e.id);

/** Employed on `date`: hired by then and not terminated before it. */
export const employedOn = (date: string) =>
  employees.filter(
    (e) =>
      e.hireDate <= date &&
      (e.terminationDate === null || e.terminationDate >= date),
  );

/** First that satisfies `pick`, or a clear failure if the fixtures changed. */
export function find<T>(
  items: T[],
  pick: (item: T) => boolean,
  what: string,
): T {
  const found = items.find(pick);
  if (!found) throw new Error(`the small fixture has no ${what}`);
  return found;
}
