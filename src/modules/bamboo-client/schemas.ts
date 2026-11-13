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
  .transform((e) => ({ ...e, supervisorEId: e.supervisorEId ?? null }));

export type BambooEmployee = z.infer<typeof employeeSchema>;

export const listEmployeesPageSchema = z.looseObject({
  data: z.array(employeeSchema),
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
