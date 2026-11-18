import { describe, expect, it } from "vitest";
import type { ActorContext } from "@/modules/actor/types";
import { canEditGoal } from "./permissions";

const goal = { personId: "owner" };
const as = (role: ActorContext["role"], personId: string | null) => ({
  role,
  personId,
});
const no = { isCurrentManager: false };
const yes = { isCurrentManager: true };

describe("canEditGoal", () => {
  it("lets the owner edit their own goal", () => {
    expect(canEditGoal(as("employee", "owner"), goal, no)).toBe(true);
    expect(canEditGoal(as("manager", "owner"), goal, no)).toBe(true);
  });
  it("lets the current manager of the owner edit it", () => {
    expect(canEditGoal(as("manager", "boss"), goal, yes)).toBe(true);
  });
  it("lets People edit any goal, with or without a person", () => {
    expect(canEditGoal(as("hr", null), goal, no)).toBe(true);
    expect(canEditGoal(as("hr", "x"), goal, no)).toBe(true);
  });
  it("refuses another employee and a manager who is not the current one", () => {
    expect(canEditGoal(as("employee", "other"), goal, no)).toBe(false);
    expect(canEditGoal(as("manager", "other"), goal, no)).toBe(false);
  });
  it("only counts the manager flag for the manager role", () => {
    expect(canEditGoal(as("employee", "other"), goal, yes)).toBe(false);
  });
  it("never lets direction", () => {
    expect(canEditGoal(as("direction", null), goal, yes)).toBe(false);
    expect(canEditGoal(as("direction", "owner"), goal, no)).toBe(false);
  });
  it("refuses an actor without a person unless People", () => {
    expect(canEditGoal(as("employee", null), goal, no)).toBe(false);
    expect(canEditGoal(as("manager", null), goal, yes)).toBe(false);
  });
});
