import { describe, expect, it } from "vitest";
import type { ActorContext } from "@/modules/actor/types";
import { navGroups, type NavMessageKey } from "./nav-items";

const t = (key: NavMessageKey) => key;
const person = "11111111-1111-4111-8111-111111111111";
const groupsOf = (actor: ActorContext) => navGroups(t, actor);
const keysOf = (actor: ActorContext) => groupsOf(actor).map((g) => g.key);

describe("navGroups", () => {
  it("gives People Goals, Assessments, the Analysis, Data and Settings, in that order", () => {
    expect(keysOf({ personId: null, role: "hr" })).toEqual([
      "goals",
      "assessments",
      "insights",
      "data",
      "settings",
    ]);
  });

  it("lists the cycles screen under Settings, for People only", () => {
    const settings = groupsOf({ personId: null, role: "hr" }).find(
      (g) => g.key === "settings",
    );
    expect(settings?.items.map((i) => i.href)).toEqual([
      "/settings/cycles",
      "/settings/insights",
    ]);
    expect(keysOf({ personId: person, role: "manager" })).not.toContain(
      "settings",
    );
  });

  it("puts Goals and Assessments first, as primary entries, apart from the analysis", () => {
    const groups = groupsOf({ personId: null, role: "hr" });
    expect(groups.map((g) => [g.key, g.primary])).toEqual([
      ["goals", true],
      ["assessments", true],
      ["insights", false],
      ["data", false],
      ["settings", false],
    ]);
    expect(groups[0].items.map((i) => i.href)).toEqual(["/goals"]);
    expect(groups[1].items.map((i) => i.href)).toEqual(["/assessments"]);
    // Nothing analytical hides inside Goals or Assessments.
    for (const g of groups.slice(0, 2)) {
      expect(g.items.every((i) => !i.href.startsWith("/insights"))).toBe(true);
    }
  });

  it("lists the analysis screens in the order the business asked for", () => {
    const insights = groupsOf({ personId: null, role: "hr" })[2];
    expect(insights.items.map((i) => i.label)).toEqual([
      "Insights.Executive.nav",
      "Completion.nav",
      "Indicators.nav",
      "Qualitative.nav",
      "Insights.SelfAssessment.nav",
      "GoalsInsights.nav",
      "Insights360.nav",
      "Engagement.nav",
    ]);
    expect(insights.items.map((i) => i.href)).toEqual([
      "/insights/executive",
      "/insights/completion",
      "/insights/indicators",
      "/insights/qualitative",
      "/insights/self-assessment",
      "/insights/goals",
      "/insights/360",
      "/insights/engagement",
    ]);
  });

  it("gives a manager Goals, Assessments and the analysis, but no Data or Settings", () => {
    expect(keysOf({ personId: person, role: "manager" })).toEqual([
      "goals",
      "assessments",
      "insights",
    ]);
  });

  it("gives an employee only Goals and Assessments", () => {
    expect(keysOf({ personId: person, role: "employee" })).toEqual([
      "goals",
      "assessments",
    ]);
  });

  it("gives direction only the analysis (aggregates, no individual goals or assessments)", () => {
    expect(keysOf({ personId: null, role: "direction" })).toEqual(["insights"]);
  });

  it("gives an employee or a manager without a person nothing to open", () => {
    expect(keysOf({ personId: null, role: "employee" })).toEqual([]);
    expect(keysOf({ personId: null, role: "manager" })).toEqual([]);
  });

  it("describes every entry", () => {
    for (const g of groupsOf({ personId: null, role: "hr" })) {
      for (const item of g.items) {
        expect(item.description).toBe(`Home.descriptions.${item.key}`);
      }
    }
  });
});
