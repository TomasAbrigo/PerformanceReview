import { describe, expect, it } from "vitest";
import type { ActorContext } from "@/modules/actor/types";
import {
  canOpenAssessment,
  canSeeExecutiveView,
  canSeeIndividuals,
  canSeeSensitiveIndicators,
  insightsScope,
} from "./authz";

const ANA = "00000000-0000-4000-8000-00000000000a";
const BRUNO = "00000000-0000-4000-8000-00000000000b";
const CARLA = "00000000-0000-4000-8000-00000000000c";

const hr: ActorContext = { personId: null, role: "hr" };
const hrPerson: ActorContext = { personId: ANA, role: "hr" };
const manager: ActorContext = { personId: ANA, role: "manager" };
const lostManager: ActorContext = { personId: null, role: "manager" };
const employee: ActorContext = { personId: BRUNO, role: "employee" };
const direction: ActorContext = { personId: null, role: "direction" };

describe("insightsScope", () => {
  it("People see everything", () => {
    expect(insightsScope(hr)).toEqual({ kind: "all" });
    expect(insightsScope(hrPerson)).toEqual({ kind: "all" });
  });

  it("a manager sees their direct reports", () => {
    expect(insightsScope(manager)).toEqual({
      kind: "directReports",
      managerPersonId: ANA,
    });
  });

  it("a manager acting without a person sees nothing", () => {
    expect(insightsScope(lostManager)).toEqual({ kind: "none" });
  });

  it("direction sees aggregates only, with the minimum group size", () => {
    expect(insightsScope(direction)).toEqual({
      kind: "aggregatesOnly",
      minGroupSize: 5,
    });
    expect(insightsScope(direction, 8)).toEqual({
      kind: "aggregatesOnly",
      minGroupSize: 8,
    });
  });

  it("the minimum only matters for direction", () => {
    expect(insightsScope(hr, 8)).toEqual({ kind: "all" });
    expect(insightsScope(manager, 8)).toEqual({
      kind: "directReports",
      managerPersonId: ANA,
    });
  });

  it("an employee sees no dashboard", () => {
    expect(insightsScope(employee)).toEqual({ kind: "none" });
  });
});

describe("canSeeIndividuals", () => {
  it("is for People and managers (their direct reports), not for direction or employees", () => {
    expect(canSeeIndividuals(hr)).toBe(true);
    expect(canSeeIndividuals(manager)).toBe(true);
    expect(canSeeIndividuals(lostManager)).toBe(false);
    expect(canSeeIndividuals(direction)).toBe(false);
    expect(canSeeIndividuals(employee)).toBe(false);
  });
});

describe("canSeeSensitiveIndicators (retention, engagement, sentiment)", () => {
  // Bruno reports to Ana at the snapshot; Carla reports to somebody else.
  const bruno = { revieweePersonId: BRUNO, snapManagerPersonId: ANA };
  const carla = { revieweePersonId: CARLA, snapManagerPersonId: BRUNO };

  it("People see them about anyone", () => {
    expect(canSeeSensitiveIndicators(hr, bruno)).toBe(true);
    expect(canSeeSensitiveIndicators(hr, carla)).toBe(true);
    expect(canSeeSensitiveIndicators(hrPerson, bruno)).toBe(true);
  });

  it("a manager sees them only about their direct reports of the snapshot", () => {
    expect(canSeeSensitiveIndicators(manager, bruno)).toBe(true);
    // A skip-level report, or someone with no manager in the snapshot.
    expect(canSeeSensitiveIndicators(manager, carla)).toBe(false);
    expect(
      canSeeSensitiveIndicators(manager, {
        revieweePersonId: CARLA,
        snapManagerPersonId: null,
      }),
    ).toBe(false);
  });

  it("a manager never sees them about themself", () => {
    expect(
      canSeeSensitiveIndicators(manager, {
        revieweePersonId: ANA,
        snapManagerPersonId: ANA,
      }),
    ).toBe(false);
  });

  it("a manager acting without a person sees none", () => {
    expect(canSeeSensitiveIndicators(lostManager, bruno)).toBe(false);
    expect(
      canSeeSensitiveIndicators(lostManager, {
        revieweePersonId: BRUNO,
        snapManagerPersonId: null,
      }),
    ).toBe(false);
  });

  it("an employee never sees them, about themself or anyone", () => {
    expect(canSeeSensitiveIndicators(employee, bruno)).toBe(false);
    expect(
      canSeeSensitiveIndicators(employee, {
        revieweePersonId: BRUNO,
        snapManagerPersonId: BRUNO,
      }),
    ).toBe(false);
    expect(canSeeSensitiveIndicators(employee, carla)).toBe(false);
  });

  it("direction never sees them about a person", () => {
    expect(canSeeSensitiveIndicators(direction, bruno)).toBe(false);
  });
});

describe("canOpenAssessment (the participant's assessment page)", () => {
  const bruno = {
    revieweePersonId: BRUNO,
    snapManagerPersonId: ANA,
    removedAt: null,
  };
  const removed = { ...bruno, removedAt: new Date("2024-03-01T12:00:00Z") };

  it("People open any participant, a removed one included", () => {
    expect(canOpenAssessment(hr, bruno)).toBe(true);
    expect(canOpenAssessment(hr, removed)).toBe(true);
  });

  it("a manager opens their direct reports of the snapshot while they are in the cycle", () => {
    expect(canOpenAssessment(manager, bruno)).toBe(true);
    expect(canOpenAssessment(manager, removed)).toBe(false);
    expect(
      canOpenAssessment(manager, { ...bruno, snapManagerPersonId: CARLA }),
    ).toBe(false);
    expect(
      canOpenAssessment(manager, {
        revieweePersonId: ANA,
        snapManagerPersonId: ANA,
        removedAt: null,
      }),
    ).toBe(false);
  });

  it("nobody else does: employees (not even their own), direction, a manager without a person", () => {
    expect(canOpenAssessment(employee, bruno)).toBe(false);
    expect(canOpenAssessment(direction, bruno)).toBe(false);
    expect(canOpenAssessment(lostManager, bruno)).toBe(false);
  });
});

describe("canSeeExecutiveView", () => {
  it("is for People and direction only", () => {
    expect(canSeeExecutiveView(hr)).toBe(true);
    expect(canSeeExecutiveView(direction)).toBe(true);
    expect(canSeeExecutiveView(manager)).toBe(false);
    expect(canSeeExecutiveView(lostManager)).toBe(false);
    expect(canSeeExecutiveView(employee)).toBe(false);
  });
});
