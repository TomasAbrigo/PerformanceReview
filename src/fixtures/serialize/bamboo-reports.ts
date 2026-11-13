import type { CompanyFixture, FixtureAssessment, FixtureEmployee } from "../company";
import {
  CUSTOM_QUESTIONS,
  MANAGER_QUESTIONS,
  SELF_QUESTIONS,
} from "../company/questions";
import { toCsv } from "./csv";
import type { FixtureFile } from "./files";

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

const displayName = (e: Pick<FixtureEmployee, "firstName" | "lastName">): string =>
  `${e.firstName} ${e.lastName}`;

/**
 * CSV files shaped like Bamboo's standard Performance reports, relative to
 * `fixtures/bamboo-reports/<size>/`. Reports identify people by NAME only.
 * Manager and Department are the CURRENT ones at export time (Bamboo quirk),
 * not those in force when the review happened.
 */
export function serializeBambooReports(company: CompanyFixture): FixtureFile[] {
  const byId = new Map(company.employees.map((e) => [e.id, e]));
  const managerName = (e: FixtureEmployee): string =>
    e.managerId === null ? "" : displayName(byId.get(e.managerId)!);

  const completed = company.assessments.filter(
    (a): a is FixtureAssessment & { employeeId: string } =>
      a.selfStatus === "Submitted" &&
      a.managerStatus === "Submitted" &&
      a.employeeId !== null,
  );
  const performanceRows = completed.map((a) => {
    const employee = byId.get(a.employeeId)!;
    const self = a.selfAnswers!;
    const manager = a.managerAnswers!;
    return [
      displayName(employee),
      managerName(employee),
      employee.department,
      company.cycles[a.cycle].name,
      a.managerSubmittedOn!,
      self.q1,
      self.q2,
      self.q3,
      self.q4,
      manager.q1,
      manager.q2,
      manager.q3,
      manager.q4,
      self.custom1,
      manager.custom1,
      self.custom2,
      manager.custom2,
    ];
  });

  const feedbackRows = company.feedback.map((f) => [
    displayName(byId.get(f.employeeId)!),
    f.reviewerId === null ? f.reviewerName! : displayName(byId.get(f.reviewerId)!),
    f.completedOn ?? "",
    f.dueDate,
    company.cycles[f.cycle].name,
  ]);

  // Goal Status: a snapshot of today, active people only.
  const goalRows: string[][] = [];
  for (const employee of company.employees) {
    if (employee.status !== "Active") continue;
    const goals = company.goals.filter((g) => g.employeeId === employee.id);
    const who = [displayName(employee), managerName(employee), employee.department];
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

  const progressRows = company.assessments
    .filter((a) => a.employeeId !== null)
    .map((a) => {
      const employee = byId.get(a.employeeId!)!;
      const bothDone = a.selfStatus === "Submitted" && a.managerStatus === "Submitted";
      const noneStarted =
        a.selfStatus === "Not Started" && a.managerStatus === "Not Started";
      return [
        displayName(employee),
        managerName(employee),
        employee.department,
        company.cycles[a.cycle].name,
        bothDone ? "Complete" : noneStarted ? "Not Started" : "In Progress",
        a.selfStatus,
        a.managerStatus,
        a.followUpNote ?? "",
      ];
    });

  return [
    {
      path: "employee-performance.csv",
      content: toCsv(EMPLOYEE_PERFORMANCE_HEADER, performanceRows),
    },
    {
      path: "feedback-status.csv",
      content: toCsv(FEEDBACK_STATUS_HEADER, feedbackRows),
    },
    {
      path: "goal-status.csv",
      content: toCsv(GOAL_STATUS_HEADER, goalRows),
    },
    {
      path: "assessment-progress.csv",
      content: toCsv(ASSESSMENT_PROGRESS_HEADER, progressRows),
    },
  ];
}
