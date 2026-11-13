/**
 * zod schemas for the BambooHR public API responses we consume.
 *
 * They describe the wire shape after our fixtures/normalisation rules:
 * ids are numeric strings, dates are ISO-8601, "no value" is `null`
 * (Bamboo's "0000-00-00" placeholder is never emitted). The fixture tests
 * validate the generated JSON against them and the real client will reuse
 * them. Unknown extra keys are tolerated (zod strips them) so a Bamboo API
 * that grows new fields does not break parsing.
 */
import { z } from "zod";

/** Internal Bamboo ids (employee, table row, goal) travel as numeric strings. */
export const bambooIdSchema = z
  .string()
  .regex(/^\d+$/, "Bamboo ids must be numeric strings");

export const isoDateSchema = z.iso.date();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** Employee `status` field. */
export const employeeStatusSchema = z.enum(["Active", "Inactive"]);

const nullableText = z.string().nullable();

/** Pagination links are plain URL paths; `{ href }` objects are tolerated. */
const linkSchema = z.union([z.string(), z.object({ href: z.string() })]);

// --- GET /api/v1/employees (cursor-paginated list) -----------------------

export const listEmployeeSchema = z.object({
  employeeId: bambooIdSchema,
  firstName: z.string(),
  lastName: z.string(),
  preferredName: nullableText,
  jobTitleName: nullableText,
  status: employeeStatusSchema,
  workEmail: nullableText,
  employeeNumber: nullableText,
  /** Internal id of the manager (not the legajo, not a name). */
  reportsToId: bambooIdSchema.nullable(),
  hireDate: isoDateSchema.nullable(),
  department: nullableText,
  division: nullableText,
  location: nullableText,
});

export const listEmployeesPageSchema = z.object({
  data: z.array(listEmployeeSchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    page: z.object({
      limit: z.number().int().positive(),
      nextCursor: z.string().nullable(),
      prevCursor: z.string().nullable(),
    }),
  }),
  _links: z.object({
    self: linkSchema,
    next: linkSchema.nullable().optional(),
    prev: linkSchema.nullable().optional(),
  }),
});

// --- GET /api/v1/employees/{id} -------------------------------------------

export const employeeSchema = z.object({
  id: bambooIdSchema,
  firstName: z.string(),
  lastName: z.string(),
  workEmail: nullableText,
  employeeNumber: nullableText,
  /** Internal id of the manager. */
  supervisorEId: bambooIdSchema.nullable(),
  /** The manager's employeeNumber (legajo), not an internal id. */
  supervisorId: nullableText,
  /** "Last, First" display name of the manager. */
  supervisor: nullableText,
  hireDate: isoDateSchema.nullable(),
  terminationDate: isoDateSchema.nullable(),
  department: nullableText,
  division: nullableText,
  jobTitle: nullableText,
  location: nullableText,
  status: employeeStatusSchema,
});

// --- GET /api/v1/employees/all/tables/{jobInfo|employmentStatus} ----------

export const jobInfoRowSchema = z.object({
  id: bambooIdSchema,
  employeeId: bambooIdSchema,
  date: isoDateSchema,
  location: nullableText,
  department: nullableText,
  division: nullableText,
  jobTitle: nullableText,
  /** Display name ("Last, First"), NOT an id: the Bamboo quirk. */
  reportsTo: nullableText,
});
export const jobInfoTableSchema = z.array(jobInfoRowSchema);

export const employmentStatusRowSchema = z.object({
  id: bambooIdSchema,
  employeeId: bambooIdSchema,
  date: isoDateSchema,
  employmentStatus: z.string(),
  comment: nullableText,
  terminationTypeId: bambooIdSchema.nullable(),
  terminationReasonId: bambooIdSchema.nullable(),
});
export const employmentStatusTableSchema = z.array(employmentStatusRowSchema);

// --- GET /api/v1/employees/changed ----------------------------------------

export const employeeChangeActionSchema = z.enum([
  "Inserted",
  "Updated",
  "Deleted",
]);

export const employeesChangedSchema = z.object({
  latest: isoDateTimeSchema,
  employees: z.record(
    bambooIdSchema,
    z.object({
      id: bambooIdSchema,
      action: employeeChangeActionSchema,
      lastChanged: isoDateTimeSchema,
    }),
  ),
});

// --- GET /api/v1_2/performance/employees/{id}/goals/aggregate -------------

export const goalStatusSchema = z.enum(["in_progress", "completed", "closed"]);

export const milestoneSchema = z.object({
  id: z.number().int(),
  employeeGoalId: z.number().int(),
  title: z.string(),
  currentValue: z.number(),
  startValue: z.number(),
  endValue: z.number(),
  completedDateTime: isoDateTimeSchema.nullable(),
  lastUpdateDateTime: isoDateTimeSchema.nullable(),
  lastUpdateUserId: z.number().int().nullable(),
});

export const goalSchema = z.object({
  id: bambooIdSchema,
  title: z.string(),
  description: nullableText,
  percentComplete: z.number().min(0).max(100),
  alignsWithOptionId: z.number().int().nullable(),
  /** Employee ids as integers (the one place Bamboo does not use strings). */
  sharedWithEmployeeIds: z.array(z.number().int()),
  dueDate: isoDateSchema,
  completionDate: isoDateSchema.nullable(),
  lastChangedDateTime: isoDateTimeSchema,
  status: goalStatusSchema,
  milestones: z.array(milestoneSchema).nullable(),
  actions: z.record(z.string(), z.boolean()),
});

export const goalsAggregateSchema = z.object({
  canAlign: z.boolean(),
  canCreateGoals: z.boolean(),
  filters: z.array(z.object({ id: z.string(), name: z.string() })),
  selectedFilter: z.string(),
  goals: z.array(goalSchema),
  persons: z.array(
    z.object({
      employeeId: z.number().int(),
      firstName: z.string(),
      lastName: z.string(),
      preferredName: nullableText,
    }),
  ),
  comments: z.array(
    z.object({
      goalId: bambooIdSchema,
      commentCount: z.number().int().nonnegative(),
    }),
  ),
});

export type ListEmployee = z.infer<typeof listEmployeeSchema>;
export type ListEmployeesPage = z.infer<typeof listEmployeesPageSchema>;
export type BambooEmployee = z.infer<typeof employeeSchema>;
export type JobInfoRow = z.infer<typeof jobInfoRowSchema>;
export type EmploymentStatusRow = z.infer<typeof employmentStatusRowSchema>;
export type EmployeesChanged = z.infer<typeof employeesChangedSchema>;
export type BambooMilestone = z.infer<typeof milestoneSchema>;
export type BambooGoal = z.infer<typeof goalSchema>;
export type GoalsAggregate = z.infer<typeof goalsAggregateSchema>;
