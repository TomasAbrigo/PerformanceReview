import { describe, expect, it } from "vitest";
import { hrefWith, parseGoalsInsightsParams } from "./url-state";

describe("parseGoalsInsightsParams", () => {
  it("defaults: by area, at review time, retention", () => {
    expect(parseGoalsInsightsParams({})).toEqual({
      cycle: undefined,
      groupBy: "department",
      hierarchy: "asOf",
      indicator: "retention",
      department: undefined,
      manager: undefined,
    });
  });

  it("takes the first of a repeated param and ignores unknown values", () => {
    expect(
      parseGoalsInsightsParams({
        groupBy: ["person", "manager"],
        hierarchy: "yesterday",
        indicator: "engagement",
        department: "",
        manager: "m1",
      }),
    ).toMatchObject({
      groupBy: "person",
      hierarchy: "asOf",
      indicator: "engagement",
      department: undefined,
      manager: "m1",
    });
  });
});

describe("hrefWith", () => {
  it("keeps the params, applies overrides and drops empty ones", () => {
    const p = parseGoalsInsightsParams({ cycle: "c1", department: "Ing" });
    expect(hrefWith("/insights/goals", p, { groupBy: "person" })).toBe(
      "/insights/goals?cycle=c1&groupBy=person&hierarchy=asOf&indicator=retention&department=Ing",
    );
    expect(hrefWith("/x", {}, {})).toBe("/x");
  });
});
