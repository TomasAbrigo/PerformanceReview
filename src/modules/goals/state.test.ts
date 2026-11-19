import { describe, expect, it } from "vitest";
import { goalAsOf, goalState, isGoalStateFilter } from "./state";

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

describe("goalAsOf", () => {
  it("is today for a cycle whose period has not ended", () => {
    expect(
      goalAsOf({ status: "collecting", periodEnd: "2026-12-31" }, today),
    ).toBe(today);
    // Even a closed one: its goals have not stopped running.
    expect(goalAsOf({ status: "closed", periodEnd: "2026-12-31" }, today)).toBe(
      today,
    );
  });

  it("is the end of the period for a closed cycle that is over", () => {
    expect(goalAsOf({ status: "closed", periodEnd: "2026-09-28" }, today)).toBe(
      "2026-09-28",
    );
  });

  it("is today for a cycle still open after its period (its goals are still synced)", () => {
    expect(
      goalAsOf({ status: "collecting", periodEnd: "2026-09-28" }, today),
    ).toBe(today);
  });

  it("is today on the last day of a closed period", () => {
    expect(goalAsOf({ status: "closed", periodEnd: today }, today)).toBe(today);
  });

  it("makes a goal due after the cut-off not overdue, however long ago it is for today", () => {
    const g = { status: "in_progress", dueDate: "2026-10-15" } as const;
    const cutoff = goalAsOf(
      { status: "closed", periodEnd: "2026-09-28" },
      today,
    );
    expect(goalState(g, cutoff)).toBe("in_progress");
    expect(goalState(g, today)).toBe("overdue");
  });
});
