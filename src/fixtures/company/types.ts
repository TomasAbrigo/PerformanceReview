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
