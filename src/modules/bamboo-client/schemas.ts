/**
 * THE zod schemas for the BambooHR responses we read. One module for all of
 * them: the client parses live responses with them, the fixture adapter parses
 * saved responses with them, and the fixture generator's tests check what it
 * writes against them (`src/fixtures/bamboo-schemas.ts` only re-exports this).
 *
 * They are deliberately tolerant. Bamboo sends ids as numbers or strings
 * depending on the endpoint and field: every id is normalized to a string.
 * Content fields are typed but optional and nullable (restricted fields come
 * back as null, and a `fields=` request omits the rest); values are not
 * validated here (dates, statuses...): that happens per record at staging, so
 * one odd record is rejected alone instead of making a whole page unreadable.
 * Unknown keys pass through untouched.
 *
 * Use `z.input<...>` for the wire shape (what Bamboo sends) and the exported
 * types for the normalized result.
 */
import { z } from "zod";

/** Bamboo returns ids as numbers or strings depending on endpoint: always string. */
export const bambooId = z.union([z.string(), z.number()]).transform(String);
export const nullableBambooId = bambooId.nullable().optional();

/** An id exactly as Bamboo sent it, for items that must stay raw. */
const rawId = z.union([z.string(), z.number()]);

const text = z.string().nullish();

/** Pagination links are plain URL paths; `{ href }` objects are tolerated. */
const link = z.union([z.string(), z.looseObject({ href: z.string() })]);

// --- GET /api/v1/employees (cursor-paginated list) -----------------------

/**
 * An item of the list. The real endpoint names the employee id `employeeId`;
 * a `fields=` response (and older fixtures) use `id`. Both are accepted and
 * `id` is always there afterwards: taken from `employeeId` when missing. An
 * item that already has an `id` is left exactly as Bamboo sent it, since this
 * is what ingest keeps as raw_record and hashes.
 */
export const listEmployeeSchema = z
  .looseObject({
    id: rawId.optional(),
    employeeId: rawId.optional(),
    firstName: text,
    lastName: text,
    preferredName: text,
    jobTitleName: text,
    status: text,
    workEmail: text,
    employeeNumber: text,
    /** Internal id of the manager (not the legajo, not a name). */
    reportsToId: rawId.nullish(),
    hireDate: text,
    department: text,
    division: text,
    location: text,
  })
  .transform((item, ctx) => {
    if (item.id != null) return { ...item, id: item.id };
    if (item.employeeId != null)
      return { ...item, id: String(item.employeeId) };
    ctx.addIssue({
      code: "custom",
      message: "employee list item has neither id nor employeeId",
    });
    return z.NEVER;
  });

export const listEmployeesPageSchema = z.looseObject({
  // Items stay raw (only `id` is guaranteed); callers parse with employeeSchema.
  data: z.array(listEmployeeSchema),
  meta: z
    .looseObject({
      total: z.number().nullish(),
      page: z
        .looseObject({
          limit: z.number().nullish(),
          nextCursor: z.string().nullish(),
          prevCursor: z.string().nullish(),
        })
        .optional(),
    })
    .optional(),
  _links: z
    .looseObject({
      self: link.nullish(),
      next: link.nullish(),
      prev: link.nullish(),
    })
    .optional(),
});

// --- GET /api/v1/employees/{id} -------------------------------------------

/** An employee record. Restricted fields come back as null; unknown keys pass. */
export const employeeSchema = z
  .looseObject({
    id: bambooId,
    firstName: text,
    lastName: text,
    displayName: text,
    workEmail: text,
    employeeNumber: text,
    status: text,
    hireDate: text,
    terminationDate: text,
    /** Internal id of the manager. */
    supervisorEId: nullableBambooId,
    /** The manager's employeeNumber (legajo), not an internal id. */
    supervisorId: text,
    /** "Last, First" display name of the manager. */
    supervisor: text,
    department: text,
    division: text,
    jobTitle: text,
    location: text,
    _restrictedFields: z.array(z.string()).optional(),
  })
  .transform((e) => ({ ...e, supervisorEId: e.supervisorEId ?? null }));

// --- employee tables (jobInfo, employmentStatus, ...) ----------------------

/** A row of an employee table. Other fields pass. */
export const tableRowSchema = z.looseObject({
  id: bambooId,
  employeeId: bambooId,
});
export const tableRowsSchema = z.array(tableRowSchema);

export const jobInfoRowSchema = tableRowSchema.extend({
  date: text,
  location: text,
  department: text,
  division: text,
  jobTitle: text,
  /** Display name ("Last, First"), NOT an id: the Bamboo quirk. */
  reportsTo: text,
});

export const employmentStatusRowSchema = tableRowSchema.extend({
  date: text,
  employmentStatus: text,
  comment: text,
  terminationTypeId: nullableBambooId,
  terminationReasonId: nullableBambooId,
});

// --- GET /api/v1/employees/changed[/tables/{table}] ------------------------

export const changedEmployeesSchema = z.looseObject({
  latest: z.string(),
  employees: z.record(
    z.string(),
    z.looseObject({
      id: bambooId,
      action: z.string(),
      lastChanged: z.string(),
    }),
  ),
});

export const changedTablesSchema = z.looseObject({
  latest: z.string().optional(),
  employees: z.record(
    z.string(),
    z.looseObject({
      lastChanged: z.string().optional(),
      rows: tableRowsSchema,
    }),
  ),
});

// --- performance goals ------------------------------------------------------

export const milestoneSchema = z.looseObject({
  id: bambooId,
  employeeGoalId: nullableBambooId,
  title: z.string().nullish(),
  currentValue: z.number().nullish(),
  startValue: z.number().nullish(),
  endValue: z.number().nullish(),
  completedDateTime: z.string().nullish(),
  lastUpdateDateTime: z.string().nullish(),
  lastUpdateUserId: nullableBambooId,
});

export const goalSchema = z
  .looseObject({
    id: bambooId,
    title: z.string().nullish(),
    description: z.string().nullish(),
    percentComplete: z.number().nullish(),
    alignsWithOptionId: nullableBambooId,
    sharedWithEmployeeIds: z.array(bambooId).nullish(),
    dueDate: z.string().nullish(),
    completionDate: z.string().nullish(),
    lastChangedDateTime: z.string().nullish(),
    // Kept as text: a status we do not know must reject one goal at staging,
    // not make the whole aggregate unreadable.
    status: z.string().nullish(),
    milestones: z.array(milestoneSchema).nullish(),
    actions: z.record(z.string(), z.boolean()).nullish(),
  })
  .transform((g) => ({
    ...g,
    sharedWithEmployeeIds: g.sharedWithEmployeeIds ?? [],
    // Goals without milestones come as null, [] or no key at all.
    milestones: g.milestones ?? [],
  }));

/** GET /api/v1_2/performance/employees/{id}/goals/aggregate */
export const goalsAggregateSchema = z
  .looseObject({
    canAlign: z.boolean().nullish(),
    canCreateGoals: z.boolean().nullish(),
    filters: z
      .array(z.looseObject({ id: z.string(), name: z.string() }))
      .nullish(),
    selectedFilter: z.string().nullish(),
    goals: z.array(goalSchema).nullish(),
    // Users and employees are different id spaces: persons maps one to the other.
    persons: z
      .array(
        z.looseObject({
          employeeId: nullableBambooId,
          userId: nullableBambooId,
          firstName: text,
          lastName: text,
          preferredName: text,
        }),
      )
      .nullish(),
    /** Per-goal comment counts (the comments themselves need another call). */
    comments: z
      .array(z.looseObject({ goalId: bambooId, commentCount: z.number() }))
      .nullish(),
  })
  .transform((a) => ({
    ...a,
    goals: a.goals ?? [],
    persons: a.persons ?? [],
    comments: a.comments ?? [],
  }));

export const goalCommentSchema = z
  .looseObject({
    id: bambooId,
    authorUserId: nullableBambooId,
    text: z.string().nullish(),
    createdAt: z.string().nullish(),
  })
  .transform((c) => ({ ...c, authorUserId: c.authorUserId ?? null }));

export const goalCommentsSchema = z
  .union([
    z.array(goalCommentSchema),
    z.looseObject({ comments: z.array(goalCommentSchema).nullish() }),
  ])
  .transform((r) => (Array.isArray(r) ? r : (r.comments ?? [])));

// --- types ------------------------------------------------------------------

/** A list-employees item as ingest keeps it: raw, with `id` guaranteed. */
export type RawBambooEmployee = z.output<typeof listEmployeeSchema>;
/** Normalized ids; every other field Bamboo returned passes through. */
export type BambooEmployee = z.output<typeof employeeSchema>;
export type BambooTableRow = z.output<typeof tableRowSchema>;
export type ChangedEmployees = z.output<typeof changedEmployeesSchema>;
export type ChangedTables = z.output<typeof changedTablesSchema>;
export type BambooGoal = z.output<typeof goalSchema>;
export type BambooGoalMilestone = BambooGoal["milestones"][number];
export type BambooGoalsAggregate = z.output<typeof goalsAggregateSchema>;
export type BambooGoalComment = z.output<typeof goalCommentSchema>;
