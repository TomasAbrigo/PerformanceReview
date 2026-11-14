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
