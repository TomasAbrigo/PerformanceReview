import {
  date,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { employment, person } from "./people";
import { sourceColumns } from "./source";

/**
 * Job/manager history (Bamboo jobInfo) as SCD2: one row per change, interval
 * [valid_from, valid_to), valid_to null = current. `source_id` is the jobInfo
 * row id. `manager_raw` keeps Bamboo's reportsTo NAME even when it could not
 * be resolved to a person (manager_person_id null). SCD2 rows are keyed by
 * (person_id, valid_from), not by source_id: collapsing identical rows and
 * same-day changes means a jobInfo row id can move between versions.
 */
export const employeeJobHistory = pgTable(
  "employee_job_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    employmentId: uuid("employment_id").references(() => employment.id),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    managerPersonId: uuid("manager_person_id").references(() => person.id),
    managerRaw: text("manager_raw"),
    department: text("department"),
    division: text("division"),
    jobTitle: text("job_title"),
    location: text("location"),
    ...sourceColumns,
  },
  (t) => [
    unique("employee_job_history_person_from_uq").on(t.personId, t.validFrom),
    index("employee_job_history_manager_idx").on(
      t.managerPersonId,
      t.validFrom,
    ),
  ],
);

export type EmployeeJobHistory = typeof employeeJobHistory.$inferSelect;

/** Employment status history (Bamboo employmentStatus) as SCD2. */
export const employeeStatusHistory = pgTable(
  "employee_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    employmentStatus: text("employment_status"),
    comment: text("comment"),
    /** termination* fields exactly as Bamboo sent them (reason, type, rehire...). */
    terminationRaw: jsonb("termination_raw").$type<Record<string, unknown>>(),
    ...sourceColumns,
  },
  (t) => [
    unique("employee_status_history_person_from_uq").on(
      t.personId,
      t.validFrom,
    ),
  ],
);

export type EmployeeStatusHistory = typeof employeeStatusHistory.$inferSelect;
