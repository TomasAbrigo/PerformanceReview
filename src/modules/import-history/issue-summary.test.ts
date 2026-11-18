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
