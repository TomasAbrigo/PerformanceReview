import { z } from "zod";
import { bambooId } from "@/modules/bamboo-client/schemas";

const optionalText = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    const s = v == null ? "" : String(v).trim();
    return s === "" ? null : s;
  });

/** Bamboo uses "0000-00-00" for empty dates. */
const optionalDate = optionalText.transform((v) =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !v.startsWith("0000") ? v : null,
);

/** Validated, normalized employee ready for the domain upsert. */
export const stagedEmployeeSchema = z
  .looseObject({
    id: bambooId,
    displayName: optionalText,
    firstName: optionalText,
    lastName: optionalText,
    workEmail: optionalText.transform((v) => v?.toLowerCase() ?? null),
    employeeNumber: optionalText,
    status: optionalText,
    hireDate: optionalDate,
    terminationDate: optionalDate,
  })
  .transform((e, ctx) => {
    const displayName =
      e.displayName ??
      ([e.firstName, e.lastName].filter(Boolean).join(" ") || null);
    if (!displayName) {
      ctx.addIssue({ code: "custom", message: "employee has no name" });
      return z.NEVER;
    }
    return {
      sourceId: e.id,
      displayName,
      workEmail: e.workEmail,
      employeeNumber: e.employeeNumber,
      status: e.status,
      hireDate: e.hireDate,
      terminationDate: e.terminationDate,
    };
  });

export type StagedEmployee = z.infer<typeof stagedEmployeeSchema>;
