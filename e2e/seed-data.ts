/**
 * Ground truth of the seeded database. e2e/global-setup.ts seeds the small
 * generated company (`pnpm db:seed --size small`), so the specs derive what
 * they expect from the same generator instead of hard-coding names and counts:
 * regenerating the fixtures does not break them.
 *
 * Bamboo gives a rehire a new id with the same legajo. The identity module
 * never links that on its own: the later id waits in the identity queue for a
 * human, so it is not a person, has no job history and no goals. `employees`
 * here are the ones that did make it into the database.
 */
import { generateCompany } from "../src/fixtures/company";
import type { FixtureEmployee, FixtureGoal } from "../src/fixtures/company";
import { FIXTURE_SEEDS } from "../src/fixtures/write";

export const company = generateCompany({
  size: "small",
  seed: FIXTURE_SEEDS.small,
});

/** Every Bamboo record the seed reads (employee `read`). */
export const records = company.employees;

/** The rehires: for each person who came back, the ids after the first. */
export const rehires = company.identity.persons
  .filter((p) => p.employeeIds.length > 1)
  .map((p) => ({
    earlier: p.employeeIds[0],
    later: p.employeeIds.slice(1),
  }));

export const recordById = new Map(records.map((e) => [e.id, e]));

const queued = new Set(rehires.flatMap((r) => r.later));

/** Records waiting in the identity queue (employee `issues`). */
export const queuedRecords = records.filter((e) => queued.has(e.id));

/** The records that became a person: one per human (the ground-truth persons). */
export const employees = records.filter((e) => !queued.has(e.id));

/** Display name the app shows (first name + last name). */
export const fullName = (e: Pick<FixtureEmployee, "firstName" | "lastName">) =>
  `${e.firstName} ${e.lastName}`;

const nameCount = new Map<string, number>();
for (const e of employees) {
  nameCount.set(fullName(e), (nameCount.get(fullName(e)) ?? 0) + 1);
}

/** Two persons with the same name cannot be told apart by a link: pick unique ones. */
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

/** Escapes text for a RegExp (names can have punctuation). */
export const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A rehire that arrives in a LATER run, against a database that already has
 * everything (identity.setup.ts): someone who left and is not one of the
 * seeded rehires comes back under this new Bamboo id, same legajo and email.
 */
export const LATER_REHIRE_ID = "9001";

export function laterRehire() {
  const earlier = find(
    employees,
    (e) =>
      e.terminationDate !== null &&
      hasUniqueName(e) &&
      !rehires.some((r) => r.earlier === e.id),
    "person who left and is not a seeded rehire",
  );
  return { earlier, later: { ...earlier, id: LATER_REHIRE_ID } };
}
