import { describe, expect, it } from "vitest";
import {
  countsTowardOverall,
  type GoalWindow,
  goalOverlapsPeriod,
} from "./goal-snapshot";

const period = { periodStart: "2026-01-01", periodEnd: "2026-06-30" };

const goal = (over: Partial<GoalWindow> = {}): GoalWindow => ({
  status: "in_progress",
  dueDate: null,
  completionDate: null,
  startDate: null,
  ...over,
});

describe("goalOverlapsPeriod", () => {
  it("includes a goal due inside the period, whatever its status", () => {
    for (const status of ["in_progress", "completed", "closed"] as const) {
      expect(
        goalOverlapsPeriod(goal({ status, dueDate: "2026-03-15" }), period),
      ).toBe(true);
    }
  });

  it("treats both ends of the period as inside", () => {
    expect(goalOverlapsPeriod(goal({ dueDate: "2026-01-01" }), period)).toBe(
      true,
    );
    expect(goalOverlapsPeriod(goal({ dueDate: "2026-06-30" }), period)).toBe(
      true,
    );
  });

  it("excludes a goal that ended before the period, even if still in progress", () => {
    expect(goalOverlapsPeriod(goal({ dueDate: "2025-12-31" }), period)).toBe(
      false,
    );
    expect(
      goalOverlapsPeriod(
        goal({
          status: "completed",
          dueDate: "2026-02-01",
          completionDate: "2025-11-20",
        }),
        period,
      ),
    ).toBe(false);
  });

  it("includes a goal still running past the end of the period", () => {
    expect(goalOverlapsPeriod(goal({ dueDate: "2026-12-31" }), period)).toBe(
      true,
    );
    expect(
      goalOverlapsPeriod(
        goal({
          status: "completed",
          dueDate: "2026-12-31",
          completionDate: "2026-08-15",
        }),
        period,
      ),
    ).toBe(true);
  });

  it("uses the completion date over the due date to know when it ended", () => {
    expect(
      goalOverlapsPeriod(
        goal({
          status: "completed",
          dueDate: "2026-12-31",
          completionDate: "2026-03-01",
        }),
        period,
      ),
    ).toBe(true);
  });

  it("includes a goal without due date only while it is in progress", () => {
    expect(goalOverlapsPeriod(goal({ status: "in_progress" }), period)).toBe(
      true,
    );
    expect(goalOverlapsPeriod(goal({ status: "closed" }), period)).toBe(false);
    expect(goalOverlapsPeriod(goal({ status: "completed" }), period)).toBe(
      false,
    );
  });

  it("excludes a goal that started after the period ended", () => {
    expect(
      goalOverlapsPeriod(
        goal({ dueDate: "2026-12-31", startDate: "2026-07-01" }),
        period,
      ),
    ).toBe(false);
    expect(
      goalOverlapsPeriod(
        goal({ dueDate: "2026-12-31", startDate: "2026-06-30" }),
        period,
      ),
    ).toBe(true);
  });
});

describe("countsTowardOverall", () => {
  it("leaves the goals rating and its comment out of the overall rating", () => {
    expect(countsTowardOverall({ role: "goals_rating" })).toBe(false);
    expect(countsTowardOverall({ role: "goals_comment" })).toBe(false);
    expect(countsTowardOverall({ role: null })).toBe(true);
  });
});
