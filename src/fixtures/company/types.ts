import type { FixtureSize } from "./config";

export type { FixtureSize };

export interface GenerateCompanyOptions {
  size: FixtureSize;
  seed: number;
}

/** Current state of one Bamboo employee record (one Bamboo id). */
export interface FixtureEmployee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  workEmail: string;
  hireDate: string;
  terminationDate: string | null;
  status: "Active" | "Inactive";
  department: string;
  division: string;
  location: string;
  jobTitle: string;
  /** Internal id of the manager; null only for the CEO. */
  managerId: string | null;
}

/** All the Bamboo records (ids) that belong to one human. */
export interface FixturePerson {
  employeeIds: string[];
}

/** Someone whose last name and work email changed after the earlier cycles. */
export interface FixtureRename {
  employeeId: string;
  previousFirstName: string;
  previousLastName: string;
  previousWorkEmail: string;
  renamedOn: string;
}

/** Two different people who share the exact same full name. */
export interface FixtureDuplicateName {
  name: string;
  employeeIds: string[];
}

/** What a perfect identity resolver should find (ground truth for tests). */
export interface IdentityGroundTruth {
  persons: FixturePerson[];
  renames: FixtureRename[];
  duplicateNames: FixtureDuplicateName[];
}

/** One row of the Bamboo `jobInfo` table (reportsTo is resolved on serialize). */
export interface FixtureJobRow {
  id: string;
  employeeId: string;
  date: string;
  location: string;
  department: string;
  division: string;
  jobTitle: string;
  managerId: string | null;
}

/** One row of the Bamboo `employmentStatus` table. */
export interface FixtureEmploymentRow {
  id: string;
  employeeId: string;
  date: string;
  employmentStatus: string;
  comment: string | null;
  terminationTypeId: string | null;
  terminationReasonId: string | null;
}

/** One historical review cycle (annual; feedback window, then assessments). */
export interface FixtureCycle {
  name: string;
  periodStart: string;
  periodEnd: string;
  feedbackOpen: string;
  feedbackDue: string;
  assessmentOpen: string;
  assessmentDue: string;
}

export type ProgressStatus = "Not Started" | "In Progress" | "Submitted";

/** One side's answers: letters for single-select Q1/Q2, text for Q3/Q4. */
export interface AssessmentAnswers {
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  /** 1-5 ratings on the two custom questions. */
  custom1: number;
  custom2: number;
}

/** A self + manager assessment of one person in one cycle. */
export interface FixtureAssessment {
  /** Index into `cycles`. */
  cycle: number;
  /** Null for rows that belong to nobody in the HRIS ("outsiders"). */
  employeeId: string | null;
  /** Name shown in reports when `employeeId` is null. */
  outsiderName: string | null;
  /** Who held the Reports-To role when the window closed. */
  managerIdAtReview: string | null;
  selfStatus: ProgressStatus;
  managerStatus: ProgressStatus;
  selfSubmittedOn: string | null;
  managerSubmittedOn: string | null;
  selfAnswers: AssessmentAnswers | null;
  managerAnswers: AssessmentAnswers | null;
  followUpNote: string | null;
}

export type GoalStatus = "in_progress" | "completed" | "closed";

export interface FixtureMilestone {
  id: number;
  employeeGoalId: number;
  title: string;
  startValue: number;
  endValue: number;
  currentValue: number;
  completedDateTime: string | null;
  lastUpdateDateTime: string;
  lastUpdateUserId: number;
}

/** A Bamboo goal (goals have no cycle id; they relate to cycles by dates). */
export interface FixtureGoal {
  id: string;
  employeeId: string;
  title: string;
  description: string;
  percentComplete: number;
  alignsWithOptionId: number | null;
  sharedWithEmployeeIds: string[];
  dueDate: string;
  completionDate: string | null;
  lastChangedDateTime: string;
  status: GoalStatus;
  milestones: FixtureMilestone[] | null;
  commentCount: number;
  lastComment: string | null;
}

/** A request for peer feedback about `employeeId` in one cycle. */
export interface FixtureFeedback {
  cycle: number;
  employeeId: string;
  /** Null for reviewers that are not in the HRIS (external). */
  reviewerId: string | null;
  /** Name shown in reports when `reviewerId` is null. */
  reviewerName: string | null;
  dueDate: string;
  /** Null when the reviewer never answered (past due). */
  completedOn: string | null;
}
