import { describe, expect, it } from "vitest";
import { stagedGoalSchema } from "./staging";

const payload = (milestones: unknown[]) => ({
  employeeId: "101",
  commentCount: 0,
  goal: {
    id: "9001",
    title: "Un objetivo",
    status: "in_progress",
    milestones,
  },
});

describe("stagedGoalSchema", () => {
  it("keeps milestones with a title, in order", () => {
    const parsed = stagedGoalSchema.parse(
      payload([
        { id: "1", title: "Primero" },
        { id: "2", title: "Segundo" },
      ]),
    );

    expect(parsed.milestones.map((m) => [m.position, m.title])).toEqual([
      [0, "Primero"],
      [1, "Segundo"],
    ]);
  });

  it.each([
    ["null", null],
    ["missing", undefined],
    ["blank", "   "],
  ])("rejects the goal when a milestone title is %s", (_name, title) => {
    const result = stagedGoalSchema.safeParse(
      payload([
        { id: "1", title: "Ok" },
        { id: "2", title },
      ]),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("milestone 2 has no title");
  });
});
