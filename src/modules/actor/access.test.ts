import { describe, expect, it } from "vitest";
import { ForbiddenError, isHr, requireHr } from "./access";
import { actorRoles } from "./types";

describe("requireHr", () => {
  it("lets People through", () => {
    expect(() => requireHr({ personId: null, role: "hr" })).not.toThrow();
    expect(isHr({ personId: null, role: "hr" })).toBe(true);
  });

  it.each(actorRoles.filter((r) => r !== "hr"))(
    "refuses %s with a forbidden error",
    (role) => {
      const actor = { personId: null, role };
      expect(isHr(actor)).toBe(false);
      expect(() => requireHr(actor)).toThrow(ForbiddenError);
      expect(() => requireHr(actor)).toThrow(
        expect.objectContaining({ code: "forbidden" }),
      );
    },
  );
});
