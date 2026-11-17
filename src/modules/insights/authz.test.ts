import { describe, expect, it } from "vitest";
import type { ActorContext } from "@/modules/actor/types";
import {
  canSeeExecutiveView,
  canSeeIndividuals,
  canSeeSensitiveIndicators,
  insightsScope,
} from "./authz";

const ANA = "00000000-0000-4000-8000-00000000000a";
const BRUNO = "00000000-0000-4000-8000-00000000000b";

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
  it("People see them about anyone", () => {
    expect(canSeeSensitiveIndicators(hr, BRUNO)).toBe(true);
    expect(canSeeSensitiveIndicators(hrPerson, BRUNO)).toBe(true);
  });

  it("a manager sees them about other people, never about themself", () => {
    expect(canSeeSensitiveIndicators(manager, BRUNO)).toBe(true);
    expect(canSeeSensitiveIndicators(manager, ANA)).toBe(false);
    expect(canSeeSensitiveIndicators(lostManager, BRUNO)).toBe(false);
  });

  it("an employee never sees them, about themself or anyone", () => {
    expect(canSeeSensitiveIndicators(employee, BRUNO)).toBe(false);
    expect(canSeeSensitiveIndicators(employee, ANA)).toBe(false);
  });

  it("direction never sees them about a person", () => {
    expect(canSeeSensitiveIndicators(direction, BRUNO)).toBe(false);
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
