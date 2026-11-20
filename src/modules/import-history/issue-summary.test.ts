import { describe, expect, it } from "vitest";
import { summarizePayload } from "@/modules/identity/service";

describe("summarizePayload of a report row", () => {
  it("names the person that could not be resolved and their role", () => {
    const payload = {
      fields: { employee_name: "Bruno Pérez", manager_name: "Zoe Nadie" },
      failedRole: "manager",
      failedName: "Zoe Nadie",
    };
    expect(summarizePayload(payload)).toMatchObject({
      displayName: "Zoe Nadie",
      role: "manager",
    });
  });
});

describe("summarizePayload of a row of the org attributes file", () => {
  it("names the person by the Nombre column, or by the EEID when the file has none", () => {
    expect(
      summarizePayload({
        fields: { employee_bamboo_id: "99", employee_name: "Zoe Nadie" },
      }).displayName,
    ).toBe("Zoe Nadie");
    expect(
      summarizePayload({ fields: { employee_bamboo_id: "99" } }).displayName,
    ).toBe("EEID 99");
  });
});

describe("summarizePayload of a raw assessments report row (#132)", () => {
  it("shows the row's work email and EEID so the reviewer can tell who it is", () => {
    const s = summarizePayload({
      fields: {
        employee_bamboo_id: "90901",
        work_email: "zoe.nadie@example.invalid",
        employee_name: "Zoe Nadie",
      },
    });
    expect(s).toMatchObject({
      displayName: "Zoe Nadie",
      workEmail: "zoe.nadie@example.invalid",
      employeeNumber: "EEID 90901",
    });
  });

  it("does not show the employee's email when the failed name is the manager", () => {
    const s = summarizePayload({
      fields: { employee_bamboo_id: "1", work_email: "a@example.invalid" },
      failedRole: "manager",
      failedName: "Zoe Nadie",
    });
    expect(s.workEmail).toBeNull();
    expect(s.employeeNumber).toBeNull();
  });
});
