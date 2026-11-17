import { describe, expect, it } from "vitest";
import { defaultLikertMappings, mapLikert } from "./index";

describe("defaultLikertMappings", () => {
  it("maps A-E to 5..1 and A-D to 5,4,2,1 for both roles", () => {
    for (const role of ["retention", "engagement"] as const) {
      expect(defaultLikertMappings[role][5]).toEqual({
        A: 5,
        B: 4,
        C: 3,
        D: 2,
        E: 1,
      });
      expect(defaultLikertMappings[role][4]).toEqual({
        A: 5,
        B: 4,
        C: 2,
        D: 1,
      });
    }
  });
});

describe("mapLikert", () => {
  it("maps letters of a 5-option set", () => {
    expect(mapLikert({ role: "retention", optionCount: 5, raw: "A" })).toEqual({
      value: 5,
      normalized: 1,
    });
    expect(mapLikert({ role: "engagement", optionCount: 5, raw: "c" })).toEqual(
      { value: 3, normalized: 0.5 },
    );
    expect(
      mapLikert({ role: "retention", optionCount: 5, raw: " E " }),
    ).toEqual({ value: 1, normalized: 0 });
  });

  it("maps letters of a 4-option set, skipping the middle", () => {
    expect(mapLikert({ role: "retention", optionCount: 4, raw: "C" })).toEqual({
      value: 2,
      normalized: 0.25,
    });
    expect(mapLikert({ role: "engagement", optionCount: 4, raw: "D" })).toEqual(
      { value: 1, normalized: 0 },
    );
  });

  it("takes the option count from the options when given", () => {
    expect(
      mapLikert({ role: "retention", options: ["A", "B", "C", "D"], raw: "B" }),
    ).toEqual({ value: 4, normalized: 0.75 });
  });

  it("defaults to the 5-option set", () => {
    expect(mapLikert({ role: "retention", raw: "D" })).toEqual({
      value: 2,
      normalized: 0.25,
    });
  });

  it("passes numbers 1..5 through", () => {
    expect(mapLikert({ role: "engagement", raw: "4" })).toEqual({
      value: 4,
      normalized: 0.75,
    });
    expect(mapLikert({ role: "retention", optionCount: 4, raw: "1" })).toEqual({
      value: 1,
      normalized: 0,
    });
  });

  it("matches Bamboo option labels in es and en, ignoring case and accents", () => {
    expect(
      mapLikert({ role: "retention", raw: "do everything to keep them" }),
    ).toEqual({ value: 5, normalized: 1 });
    expect(
      mapLikert({ role: "retention", raw: "Me sentiria ALIVIADO" }),
    ).toEqual({ value: 1, normalized: 0 });
    expect(mapLikert({ role: "engagement", raw: "Highly engaged" })).toEqual({
      value: 5,
      normalized: 1,
    });
    expect(mapLikert({ role: "engagement", raw: "algo comprometido" })).toEqual(
      { value: 3, normalized: 0.5 },
    );
  });

  it("rejects numbers above the option count and applies overrides to numbers", () => {
    expect(mapLikert({ role: "engagement", optionCount: 4, raw: "5" })).toEqual(
      { unmapped: true },
    );
    expect(
      mapLikert({ role: "engagement", raw: "3" }, { engagement: { "5:3": 4 } }),
    ).toEqual({ value: 4, normalized: 0.75 });
  });

  it("reports letters, numbers and text outside the table as unmapped", () => {
    expect(mapLikert({ role: "retention", optionCount: 4, raw: "E" })).toEqual({
      unmapped: true,
    });
    expect(mapLikert({ role: "retention", raw: "F" })).toEqual({
      unmapped: true,
    });
    expect(mapLikert({ role: "engagement", raw: "6" })).toEqual({
      unmapped: true,
    });
    expect(mapLikert({ role: "engagement", raw: "maybe" })).toEqual({
      unmapped: true,
    });
    expect(mapLikert({ role: "engagement", raw: "" })).toEqual({
      unmapped: true,
    });
  });

  it("applies overrides by option, or by option count and option", () => {
    const overrides = {
      retention: { "4:C": 3, F: 1 },
      engagement: { A: 4 },
    };
    expect(
      mapLikert({ role: "retention", optionCount: 4, raw: "C" }, overrides),
    ).toEqual({ value: 3, normalized: 0.5 });
    expect(
      mapLikert({ role: "retention", optionCount: 5, raw: "C" }, overrides),
    ).toEqual({ value: 3, normalized: 0.5 });
    expect(mapLikert({ role: "retention", raw: "f" }, overrides)).toEqual({
      value: 1,
      normalized: 0,
    });
    expect(mapLikert({ role: "engagement", raw: "A" }, overrides)).toEqual({
      value: 4,
      normalized: 0.75,
    });
  });

  it("ignores override values outside 1..5", () => {
    expect(
      mapLikert({ role: "retention", raw: "A" }, { retention: { A: 9 } }),
    ).toEqual({ unmapped: true });
  });
});
