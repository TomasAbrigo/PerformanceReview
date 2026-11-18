import { describe, expect, it } from "vitest";
import {
  checkSettings,
  DEFAULT_SETTINGS,
  parseSettingValue,
  settingKeys,
} from "./definitions";

describe("DEFAULT_SETTINGS", () => {
  it("has the documented defaults", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      "alerts.dropThreshold": 2,
      "alerts.riskThreshold": 2,
      "aggregation.minGroupSize": 5,
      "semester.h1Start": "03-29",
      "semester.h2Start": "09-29",
      "semester.ambiguityDays": 15,
      "analysis.provider": "mock",
      "analysis.includeClosed": true,
      "engagement.cutoffAlto": 80,
      "engagement.cutoffMedio": 60,
      "engagement.cutoffRegular": 40,
    });
  });

  it("every default passes its own validation", () => {
    for (const key of settingKeys) {
      expect(parseSettingValue(key, DEFAULT_SETTINGS[key]).success).toBe(true);
    }
  });
});

describe("parseSettingValue", () => {
  it("accepts integer thresholds in range and rejects the rest", () => {
    for (const key of [
      "alerts.dropThreshold",
      "alerts.riskThreshold",
    ] as const) {
      expect(parseSettingValue(key, 1).success).toBe(true);
      expect(parseSettingValue(key, 4).success).toBe(true);
      for (const bad of [0, 5, 1.5, "2", null, Number.NaN]) {
        expect(parseSettingValue(key, bad).success, `${key} ${bad}`).toBe(
          false,
        );
      }
    }
  });

  it("the minimum group size is an integer from 2 to 100", () => {
    const key = "aggregation.minGroupSize";
    expect(parseSettingValue(key, 2).success).toBe(true);
    expect(parseSettingValue(key, 100).success).toBe(true);
    for (const bad of [1, 0, -3, 101, 2.5, "5"]) {
      expect(parseSettingValue(key, bad).success, `${bad}`).toBe(false);
    }
  });

  it("semester starts are real MM-DD days", () => {
    for (const key of ["semester.h1Start", "semester.h2Start"] as const) {
      for (const ok of ["01-01", "07-01", "02-28", "12-31"]) {
        expect(parseSettingValue(key, ok).success, ok).toBe(true);
      }
      for (const bad of [
        "1-1",
        "13-01",
        "00-10",
        "02-29", // does not exist in most years: not a semester start
        "02-30",
        "04-31",
        "0701",
        "",
        701,
      ]) {
        expect(parseSettingValue(key, bad).success, `${bad}`).toBe(false);
      }
    }
  });

  it("the ambiguity margin is an integer from 0 to 60 days", () => {
    const key = "semester.ambiguityDays";
    expect(parseSettingValue(key, 0).success).toBe(true);
    expect(parseSettingValue(key, 60).success).toBe(true);
    for (const bad of [-1, 61, 7.5, "15"]) {
      expect(parseSettingValue(key, bad).success, `${bad}`).toBe(false);
    }
  });

  it("the provider is one of the known ones", () => {
    expect(parseSettingValue("analysis.provider", "mock").success).toBe(true);
    expect(parseSettingValue("analysis.provider", "anthropic").success).toBe(
      true,
    );
    expect(parseSettingValue("analysis.provider", "gpt").success).toBe(false);
  });

  it("includeClosed is a boolean", () => {
    expect(parseSettingValue("analysis.includeClosed", false).success).toBe(
      true,
    );
    for (const bad of ["true", 1, null]) {
      expect(parseSettingValue("analysis.includeClosed", bad).success).toBe(
        false,
      );
    }
  });

  it("reports stable issue codes the UI can translate", () => {
    const result = parseSettingValue("aggregation.minGroupSize", 1);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.issues).toEqual([{ message: "out_of_range" }]);
    const bad = parseSettingValue("semester.h1Start", "02-30");
    if (!bad.success) expect(bad.issues).toEqual([{ message: "invalid_day" }]);
    const nan = parseSettingValue("alerts.dropThreshold", "x");
    if (!nan.success)
      expect(nan.issues).toEqual([{ message: "invalid_number" }]);
  });
});

describe("checkSettings (rules across keys)", () => {
  it("the engagement cutoffs must be strictly decreasing", () => {
    expect(
      checkSettings({ ...DEFAULT_SETTINGS, "engagement.cutoffMedio": 80 }),
    ).toEqual([{ path: "engagement.cutoffMedio", message: "cutoff_order" }]);
    expect(
      checkSettings({ ...DEFAULT_SETTINGS, "engagement.cutoffRegular": 70 }),
    ).toEqual([{ path: "engagement.cutoffRegular", message: "cutoff_order" }]);
    expect(
      checkSettings({
        ...DEFAULT_SETTINGS,
        "engagement.cutoffAlto": 90,
        "engagement.cutoffMedio": 70,
        "engagement.cutoffRegular": 50,
      }),
    ).toEqual([]);
  });

  it("H1 must start before H2", () => {
    expect(checkSettings(DEFAULT_SETTINGS)).toEqual([]);
    expect(
      checkSettings({ ...DEFAULT_SETTINGS, "semester.h1Start": "10-01" }),
    ).toEqual([{ path: "semester.h2Start", message: "semester_order" }]);
    expect(
      checkSettings({
        ...DEFAULT_SETTINGS,
        "semester.h1Start": "08-01",
        "semester.h2Start": "07-01",
      }),
    ).toEqual([{ path: "semester.h2Start", message: "semester_order" }]);
  });
});
