import { describe, expect, it } from "vitest";
import { hrefWith, parseGoalsInsightsParams } from "./url-state";

const CYCLE = "8d8d2b72-0c8a-4e7e-bab0-42b903eeff48";
const MANAGER = "00000000-0000-4000-8000-00000000000a";

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
        manager: MANAGER,
      }),
    ).toMatchObject({
      groupBy: "person",
      hierarchy: "asOf",
      indicator: "engagement",
      department: undefined,
      manager: MANAGER,
    });
  });

  it("drops an id that is not a uuid instead of passing it on (a 500 for the page)", () => {
    const p = parseGoalsInsightsParams({ cycle: "nope", manager: "1; drop" });
    expect(p.cycle).toBeUndefined();
    expect(p.manager).toBeUndefined();
    expect(
      parseGoalsInsightsParams({ cycle: CYCLE, manager: [MANAGER, "x"] }),
    ).toMatchObject({ cycle: CYCLE, manager: MANAGER });
  });
});

describe("hrefWith", () => {
  it("keeps the params, applies overrides and drops empty ones", () => {
    const p = parseGoalsInsightsParams({ cycle: CYCLE, department: "Ing" });
    expect(hrefWith("/insights/goals", p, { groupBy: "person" })).toBe(
      `/insights/goals?cycle=${CYCLE}&groupBy=person&hierarchy=asOf&indicator=retention&department=Ing`,
    );
    expect(hrefWith("/x", {}, {})).toBe("/x");
  });
});
