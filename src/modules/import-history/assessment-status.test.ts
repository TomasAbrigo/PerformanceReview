import { describe, expect, it } from "vitest";
import { parseStatusCell, stagedStatusSchema } from "./assessment-status";

describe("parseStatusCell", () => {
  it("reads Spanish and English statuses and who the manager is", () => {
    expect(parseStatusCell("Completado")).toEqual({
      status: "submitted",
      by: null,
    });
    expect(parseStatusCell("Completed by Ana Pérez")).toEqual({
      status: "submitted",
      by: "Ana Pérez",
    });
    expect(parseStatusCell("No iniciado por Luis Soto")).toEqual({
      status: "not_started",
      by: "Luis Soto",
    });
    expect(parseStatusCell("In progress by Eva Ruiz")).toEqual({
      status: "in_progress",
      by: "Eva Ruiz",
    });
    expect(parseStatusCell("En curso")?.status).toBe("in_progress");
    expect(parseStatusCell(null)?.status).toBe("not_applicable");
    expect(parseStatusCell("Whatever")).toBeNull();
  });
});

describe("stagedStatusSchema", () => {
  const row = (fields: Record<string, unknown>) => ({
    format: "assessment_status",
    dateFormat: "mdy",
    fields: {
      employee_name: "Ana Pérez",
      employee_number: "1042",
      period: "03/29/2024 - 09/28/2024",
      self_status: "Completado",
      manager_status: "Completed by Luis Soto",
      follow_up_notes: null,
      ...fields,
    },
  });

  it("parses the period start and both statuses", () => {
    const parsed = stagedStatusSchema.parse(row({}));
    expect(parsed.fields).toMatchObject({
      period_start: "2024-03-29",
      self_status: "submitted",
      manager_status: "submitted",
      manager_name: "Luis Soto",
    });
  });

  it("rejects a period or a status it cannot read", () => {
    expect(stagedStatusSchema.safeParse(row({ period: "H1" })).success).toBe(
      false,
    );
    expect(
      stagedStatusSchema.safeParse(row({ self_status: "Done-ish" })).success,
    ).toBe(false);
  });
});
