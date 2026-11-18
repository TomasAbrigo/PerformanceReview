import { describe, expect, it } from "vitest";
import { goalState, isGoalStateFilter } from "./state";

const today = "2026-11-18";

describe("goalState", () => {
  it("is overdue when in progress and due before today", () => {
    expect(
      goalState({ status: "in_progress", dueDate: "2026-11-17" }, today),
    ).toBe("overdue");
  });

  it("is not overdue on its due day, nor without a due date", () => {
    expect(
      goalState({ status: "in_progress", dueDate: "2026-11-18" }, today),
    ).toBe("in_progress");
    expect(goalState({ status: "in_progress", dueDate: null }, today)).toBe(
      "in_progress",
    );
  });

  it("never calls a finished goal overdue, whatever its due date", () => {
    expect(
      goalState({ status: "completed", dueDate: "2020-01-01" }, today),
    ).toBe("completed");
    expect(goalState({ status: "closed", dueDate: "2020-01-01" }, today)).toBe(
      "closed",
    );
  });
});

describe("isGoalStateFilter", () => {
  it("accepts the four states and nothing else", () => {
    for (const s of ["in_progress", "completed", "closed", "overdue"]) {
      expect(isGoalStateFilter(s)).toBe(true);
    }
    expect(isGoalStateFilter("done")).toBe(false);
    expect(isGoalStateFilter(undefined)).toBe(false);
  });
});
