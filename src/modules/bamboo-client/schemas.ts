import { z } from "zod";

/** Bamboo returns ids as numbers or strings depending on endpoint: always string. */
export const bambooId = z.union([z.string(), z.number()]).transform(String);
export const nullableBambooId = bambooId.nullable().optional();

/** An employee record. Restricted fields come back as null; unknown keys pass. */
export const employeeSchema = z
  .looseObject({
    id: bambooId,
    supervisorEId: nullableBambooId,
    _restrictedFields: z.array(z.string()).optional(),
  })
  .transform((e): BambooEmployee => ({
    ...e,
    supervisorEId: e.supervisorEId ?? null,
  }));

/** Normalized ids; every other field Bamboo returned passes through. */
export type BambooEmployee = Record<string, unknown> & {
  id: string;
  supervisorEId: string | null;
  _restrictedFields?: string[];
};

export const listEmployeesPageSchema = z.looseObject({
  // Items stay unparsed (raw) here; callers parse with employeeSchema.
  data: z.array(z.looseObject({ id: z.union([z.string(), z.number()]) })),
  meta: z
    .looseObject({
      page: z
        .looseObject({ nextCursor: z.string().nullable().optional() })
        .optional(),
    })
    .optional(),
});

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

export type ChangedEmployees = z.infer<typeof changedEmployeesSchema>;

/** A row of an employee table (jobInfo, employmentStatus, ...). Other fields pass. */
export const tableRowSchema = z.looseObject({
  id: bambooId,
  employeeId: bambooId,
});

export type BambooTableRow = z.infer<typeof tableRowSchema>;

export const tableRowsSchema = z.array(tableRowSchema);

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

export type ChangedTables = z.infer<typeof changedTablesSchema>;

/** A list-employees item exactly as Bamboo returned it. */
export type RawBambooEmployee = Record<string, unknown> & {
  id: string | number;
};
