import { describe, expect, it } from "vitest";
import { notificationHref } from "./href";

const CYCLE = "00000000-0000-4000-8000-0000000000c1";

describe("notificationHref", () => {
  it.each(["reminder_due", "manual_reminder"] as const)(
    "%s about a self assessment opens the form",
    (kind) => {
      expect(
        notificationHref({
          kind,
          cycleId: CYCLE,
          payload: { relationship: "self" },
        }),
      ).toBe(`/cycles/${CYCLE}/self`);
    },
  );

  it("sends every other task, and events, to the task inbox", () => {
    expect(
      notificationHref({
        kind: "reminder_due",
        cycleId: CYCLE,
        payload: { relationship: "manager" },
      }),
    ).toBe("/me");
    expect(
      notificationHref({
        kind: "cycle_phase_changed",
        cycleId: CYCLE,
        payload: {},
      }),
    ).toBe("/me");
    expect(
      notificationHref({ kind: "review_shared", cycleId: null, payload: {} }),
    ).toBe("/me");
  });
});
