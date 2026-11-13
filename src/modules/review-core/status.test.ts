import { describe, expect, it } from "vitest";
import { allowedTransitions, canTransition, phasesFor } from "./status";

const all = {
  self: true,
  manager: true,
  peer: true,
  upward: false,
  calibration: true,
};

describe("cycle status machine", () => {
  it("lists the phases of a cycle with every component", () => {
    expect(phasesFor(all)).toEqual([
      "draft",
      "nominations",
      "collecting",
      "manager_review",
      "calibration",
      "sharing",
      "closed",
    ]);
  });

  it("skips nominations without peers and calibration when disabled", () => {
    expect(phasesFor({ ...all, peer: false, calibration: false })).toEqual([
      "draft",
      "collecting",
      "manager_review",
      "sharing",
      "closed",
    ]);
  });

  it("allows one step forward and one step back, never back to draft", () => {
    expect(allowedTransitions(all, "collecting")).toEqual([
      "manager_review",
      "nominations",
    ]);
    expect(allowedTransitions(all, "nominations")).toEqual(["collecting"]);
    expect(canTransition(all, "collecting", "calibration")).toBe(false);
    expect(canTransition(all, "sharing", "closed")).toBe(true);
  });

  it("treats closed as terminal and draft as launch-only", () => {
    expect(allowedTransitions(all, "closed")).toEqual([]);
    expect(allowedTransitions(all, "draft")).toEqual([]);
  });
});
