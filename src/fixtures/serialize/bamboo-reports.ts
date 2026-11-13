import type { CompanyFixture } from "../company";
import { groupGoalsByEmployee } from "../company/goals";
import {
  CUSTOM_QUESTIONS,
  MANAGER_QUESTIONS,
  SELF_QUESTIONS,
} from "../company/questions";
import { toCsv } from "./csv";
import type { FixtureFile } from "./files";
import { createReportNamer } from "./report-names";

export const EMPLOYEE_PERFORMANCE_HEADER = [
  "Employee Name",
  "Manager",
  "Department",
  "Review Cycle",
  "Assessment Date",
  `Employee Q1: ${SELF_QUESTIONS.q1.text}`,
  `Employee Q2: ${SELF_QUESTIONS.q2.text}`,
  `Employee Q3: ${SELF_QUESTIONS.q3.text}`,
  `Employee Q4: ${SELF_QUESTIONS.q4.text}`,
  `Manager Q1: ${MANAGER_QUESTIONS.q1.text}`,
  `Manager Q2: ${MANAGER_QUESTIONS.q2.text}`,
  `Manager Q3: ${MANAGER_QUESTIONS.q3.text}`,
  `Manager Q4: ${MANAGER_QUESTIONS.q4.text}`,
  `Employee Custom Q1: ${CUSTOM_QUESTIONS[0].employeeText}`,
  `Manager Custom Q1: ${CUSTOM_QUESTIONS[0].managerText}`,
  `Employee Custom Q2: ${CUSTOM_QUESTIONS[1].employeeText}`,
  `Manager Custom Q2: ${CUSTOM_QUESTIONS[1].managerText}`,
] as const;

export const FEEDBACK_STATUS_HEADER = [
  "Employee Name",
  "Receiving Feedback From",
  "Date Completed",
  "Due Date",
  "Review Cycle",
] as const;

export const GOAL_STATUS_HEADER = [
  "Employee Name",
  "Manager",
  "Department",
  "Goal",
  "Due Date",
  "Progress",
  "Status",
  "Last Comment",
] as const;

export const ASSESSMENT_PROGRESS_HEADER = [
  "Employee Name",
  "Manager",
  "Department",
  "Review Cycle",
  "Assessed",
  "Self Status",
  "Manager Status",
  "Follow-up Notes",
] as const;

const GOAL_STATUS_LABEL = {
  in_progress: "In Progress",
  completed: "Completed",
  closed: "Closed",
} as const;

/** Plain code-unit ordering keeps the output identical on every machine. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function sortRows(rows: string[][], ...columns: number[]): string[][] {
  return [...rows].sort((a, b) => {
    for (const column of columns) {
      const order = byText(String(a[column]), String(b[column]));
      if (order !== 0) return order;
    }
    return 0;
  });
}

/**
 * CSV files shaped like Bamboo's standard Performance reports, relative to
 * `fixtures/bamboo-reports/<size>/`. Reports identify people by NAME only.
 * Manager and Department are the CURRENT ones at export time (Bamboo quirk),
 * not those in force when the review happened. Names are the ones in force
 * during each cycle, plus a few typos and rows about people who are not in
 * the HRIS (see `company.identity`).
 */
export function serializeBambooReports(company: CompanyFixture): FixtureFile[] {
  const byId = new Map(company.employees.map((e) => [e.id, e]));
  const names = createReportNamer(company);
  const managerName = (managerId: string | null): string =>
    managerId === null ? "" : names.current(managerId);
  const cycleName = (index: number): string => company.cycles[index].name;

  // Employee Performance: completed self + manager assessments only.
  const performanceRows = company.assessments
    .filter(
      (a) => a.selfStatus === "Submitted" && a.managerStatus === "Submitted",
    )
    .map((a) => {
      const employee = a.employeeId === null ? null : byId.get(a.employeeId)!;
      const self = a.selfAnswers!;
      const manager = a.managerAnswers!;
      return [
        employee === null
          ? a.outsiderName!
          : names.inCycle(employee.id, a.cycle),
        employee === null
          ? managerName(a.managerIdAtReview)
          : managerName(employee.managerId),
        (employee ?? byId.get(a.managerIdAtReview!)!).department,
        cycleName(a.cycle),
        a.managerSubmittedOn!,
        self.q1,
        self.q2,
        self.q3,
        self.q4,
        manager.q1,
        manager.q2,
        manager.q3,
        manager.q4,
        String(self.custom1),
        String(manager.custom1),
        String(self.custom2),
        String(manager.custom2),
      ];
    });

  // Feedback Status: who gives feedback to whom.
  const feedbackRows = company.feedback.map((f) => [
    names.inCycle(f.employeeId, f.cycle),
    f.reviewerId === null
      ? f.reviewerName!
      : names.inCycle(f.reviewerId, f.cycle),
    f.completedOn ?? "",
    f.dueDate,
    cycleName(f.cycle),
  ]);

  // Goal Status: a snapshot of today, active people only.
  const goalsByEmployee = groupGoalsByEmployee(company.goals);
  const goalRows: string[][] = [];
  for (const employee of company.employees) {
    if (employee.status !== "Active") continue;
    const goals = goalsByEmployee.get(employee.id) ?? [];
    const who = [
      names.current(employee.id),
      managerName(employee.managerId),
      employee.department,
    ];
    if (goals.length === 0) {
      goalRows.push([...who, "", "", "", "No Goals Set", ""]);
    }
    for (const g of goals) {
      const overdue = g.status === "in_progress" && g.dueDate < company.asOf;
      goalRows.push([
        ...who,
        g.title,
        g.dueDate,
        `${g.percentComplete}%`,
        overdue ? "Past Due" : GOAL_STATUS_LABEL[g.status],
        g.lastComment ?? "",
      ]);
    }
  }

  // Assessment Progress: everyone invited to the cycle.
  const progressRows = company.assessments
    .filter((a) => a.employeeId !== null)
    .map((a) => {
      const employee = byId.get(a.employeeId!)!;
      const bothDone =
        a.selfStatus === "Submitted" && a.managerStatus === "Submitted";
      const noneStarted =
        a.selfStatus === "Not Started" && a.managerStatus === "Not Started";
      return [
        names.inCycle(employee.id, a.cycle),
        managerName(employee.managerId),
        employee.department,
        cycleName(a.cycle),
        bothDone ? "Complete" : noneStarted ? "Not Started" : "In Progress",
        a.selfStatus,
        a.managerStatus,
        a.followUpNote ?? "",
      ];
    });

  return [
    {
      path: "employee-performance.csv",
      content: toCsv(
        EMPLOYEE_PERFORMANCE_HEADER,
        sortRows(performanceRows, 3, 0),
      ),
    },
    {
      path: "feedback-status.csv",
      content: toCsv(FEEDBACK_STATUS_HEADER, sortRows(feedbackRows, 4, 0, 1)),
    },
    {
      path: "goal-status.csv",
      content: toCsv(GOAL_STATUS_HEADER, sortRows(goalRows, 0, 4, 3)),
    },
    {
      path: "assessment-progress.csv",
      content: toCsv(ASSESSMENT_PROGRESS_HEADER, sortRows(progressRows, 3, 0)),
    },
  ];
}
