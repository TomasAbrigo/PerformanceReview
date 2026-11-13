import { addDays, dateBetween } from "./dates";
import {
  FOLLOW_UP_NOTES,
  MANAGER_IMPROVEMENTS,
  MANAGER_STRENGTHS,
  SELF_IMPROVEMENTS,
  SELF_STRENGTHS,
} from "./questions";
import type { Rng } from "./rng";
import type {
  AssessmentAnswers,
  FixtureAssessment,
  FixtureCycle,
  FixtureEmployee,
  FixtureFeedback,
  FixtureJobRow,
  IdentityGroundTruth,
} from "./types";

export const CYCLE_YEARS = [2023, 2024, 2025] as const;

export function buildCycles(): FixtureCycle[] {
  return CYCLE_YEARS.map((year) => ({
    name: `Evaluación de desempeño ${year}`,
    periodStart: `${year}-01-01`,
    periodEnd: `${year}-12-31`,
    feedbackOpen: `${year}-11-06`,
    feedbackDue: `${year}-11-24`,
    assessmentOpen: `${year}-11-27`,
    assessmentDue: `${year}-12-15`,
  }));
}

export interface ReviewsInput {
  employees: FixtureEmployee[];
  jobHistory: FixtureJobRow[];
  identity: IdentityGroundTruth;
}

export interface Reviews {
  cycles: FixtureCycle[];
  assessments: FixtureAssessment[];
  feedback: FixtureFeedback[];
}

/** jobInfo row in force for `employeeId` on `date` (last one on or before it). */
export function rowOnDate(
  rowsByEmployee: Map<string, FixtureJobRow[]>,
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

export function groupJobRows(
  jobHistory: FixtureJobRow[],
): Map<string, FixtureJobRow[]> {
  const byEmployee = new Map<string, FixtureJobRow[]>();
  for (const row of jobHistory) {
    byEmployee.set(row.employeeId, [...(byEmployee.get(row.employeeId) ?? []), row]);
  }
  for (const rows of byEmployee.values()) {
    rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  return byEmployee;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Letter A (best) .. last letter (worst) from a 1-5 score. */
function letterFor(score: number, letters: string): string {
  const step = 4 / letters.length;
  const index = clamp(Math.floor((5 - score) / step), 0, letters.length - 1);
  return letters[index];
}

export function buildReviews(rng: Rng, input: ReviewsInput): Reviews {
  const cycles = buildCycles();
  const rowsByEmployee = groupJobRows(input.jobHistory);
  const personOf = new Map<string, number>();
  input.identity.persons.forEach((person, index) =>
    person.employeeIds.forEach((id) => personOf.set(id, index)),
  );
  const performance = new Map<number, number>();
  const assessments: FixtureAssessment[] = [];
  const feedback: FixtureFeedback[] = [];

  const answers = (
    score: number,
    kind: "self" | "manager",
  ): AssessmentAnswers => {
    const noise = () => (rng.next() - 0.5) * 1.2;
    const rate = (shift: number) => clamp(Math.round(score + shift + noise()), 1, 5);
    return {
      q1: letterFor(clamp(score + noise(), 1, 5), kind === "self" ? "ABCD" : "ABCDE"),
      q2:
        kind === "self"
          ? rng.weighted([["A", 25], ["B", 15], ["C", 25], ["D", 25], ["E", 10]] as const)
          : letterFor(clamp(score + noise(), 1, 5), "ABCDE"),
      q3: rng.pick(kind === "self" ? SELF_STRENGTHS : MANAGER_STRENGTHS),
      q4: rng.pick(kind === "self" ? SELF_IMPROVEMENTS : MANAGER_IMPROVEMENTS),
      custom1: rate(kind === "self" ? 0.3 : 0),
      custom2: rate(kind === "self" ? 0.3 : 0),
    };
  };

  cycles.forEach((cycle, cycleIndex) => {
    const participants = input.employees.filter(
      (e) =>
        e.hireDate <= addDays(cycle.assessmentOpen, -60) &&
        (e.terminationDate === null || e.terminationDate > cycle.assessmentDue),
    );
    for (const employee of participants) {
      const person = personOf.get(employee.id)!;
      const score = clamp(
        (performance.get(person) ?? 2.5 + rng.next() * 2) + (rng.next() - 0.5),
        1.2,
        4.9,
      );
      performance.set(person, score);
      const managerIdAtReview =
        rowOnDate(rowsByEmployee, employee.id, cycle.assessmentDue)
          ?.managerId ?? null;
      const base = {
        cycle: cycleIndex,
        employeeId: employee.id,
        outsiderName: null,
        managerIdAtReview,
      };
      const idle = {
        selfStatus: "Not Started",
        managerStatus: "Not Started",
        selfSubmittedOn: null,
        managerSubmittedOn: null,
        selfAnswers: null,
        managerAnswers: null,
        followUpNote: null,
      } as const;
      if (managerIdAtReview === null) {
        assessments.push({ ...base, ...idle });
        continue;
      }
      const roll = rng.next();
      if (roll >= 0.9) {
        assessments.push({ ...base, ...idle });
        continue;
      }
      const selfOn = dateBetween(cycle.assessmentOpen, addDays(cycle.assessmentDue, -3), rng.int);
      const selfAnswers = answers(score, "self");
      if (roll >= 0.78) {
        const managerWorking = rng.chance(0.6);
        assessments.push({
          ...base,
          ...idle,
          selfStatus: managerWorking ? "Submitted" : "In Progress",
          managerStatus: managerWorking ? "In Progress" : "Not Started",
          selfSubmittedOn: managerWorking ? selfOn : null,
          selfAnswers: managerWorking ? selfAnswers : null,
        });
        continue;
      }
      assessments.push({
        ...base,
        selfStatus: "Submitted",
        managerStatus: "Submitted",
        selfSubmittedOn: selfOn,
        managerSubmittedOn: dateBetween(selfOn, cycle.assessmentDue, rng.int),
        selfAnswers,
        managerAnswers: answers(score, "manager"),
        followUpNote: rng.chance(0.2) ? rng.pick(FOLLOW_UP_NOTES) : null,
      });
    }

    // Peer feedback: 2-4 colleagues from the same department, ahead of the assessments.
    const colleagues = input.employees.filter(
      (e) =>
        e.hireDate < cycle.feedbackOpen &&
        (e.terminationDate === null || e.terminationDate > cycle.feedbackDue),
    );
    const departmentOf = new Map(
      colleagues.map((e) => [
        e.id,
        rowOnDate(rowsByEmployee, e.id, cycle.feedbackDue)?.department,
      ]),
    );
    for (const a of assessments) {
      if (a.cycle !== cycleIndex || a.managerIdAtReview === null) continue;
      const own = departmentOf.get(a.employeeId!);
      const sameDepartment = colleagues.filter(
        (e) => e.id !== a.employeeId && departmentOf.get(e.id) === own,
      );
      const pool = sameDepartment.length >= 2
        ? sameDepartment
        : colleagues.filter((e) => e.id !== a.employeeId);
      for (const reviewer of rng.shuffle(pool).slice(0, rng.int(2, 4))) {
        feedback.push({
          cycle: cycleIndex,
          employeeId: a.employeeId!,
          reviewerId: reviewer.id,
          reviewerName: null,
          dueDate: cycle.feedbackDue,
          completedOn: rng.chance(0.82)
            ? dateBetween(cycle.feedbackOpen, cycle.feedbackDue, rng.int)
            : null,
        });
      }
    }
  });

  return { cycles, assessments, feedback };
}
