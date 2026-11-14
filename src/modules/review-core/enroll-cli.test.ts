import { describe, expect, it } from "vitest";
import { parseEnrollArgs } from "./enroll-cli";

describe("parseEnrollArgs", () => {
  it("defaults to every cycle and today", () => {
    expect(parseEnrollArgs([])).toEqual({ help: false });
  });

  it("takes one cycle and a date", () => {
    expect(
      parseEnrollArgs([
        "--cycle",
        "00000000-0000-4000-8000-000000000001",
        "--as-of",
        "2026-02-28",
      ]),
    ).toEqual({
      help: false,
      cycleId: "00000000-0000-4000-8000-000000000001",
      asOf: "2026-02-28",
    });
  });

  it("rejects dates that do not exist", () => {
    expect(() => parseEnrollArgs(["--as-of", "2026-02-30"])).toThrow(/--as-of/);
    expect(() => parseEnrollArgs(["--as-of", "hoy"])).toThrow(/--as-of/);
  });

  it("takes how many extra days to look back", () => {
    expect(parseEnrollArgs(["--lookback-days", "7"])).toEqual({
      help: false,
      lookbackDays: 7,
    });
    expect(parseEnrollArgs(["--lookback-days", "0"]).lookbackDays).toBe(0);
    for (const bad of ["abc", "-1", "1.5", "366", ""]) {
      expect(() => parseEnrollArgs(["--lookback-days", bad])).toThrow(
        /--lookback-days/,
      );
    }
  });

  it("rejects ids that are not uuids and unknown options", () => {
    expect(() => parseEnrollArgs(["--cycle", "abc"])).toThrow(/--cycle/);
    expect(() => parseEnrollArgs(["--nope"])).toThrow();
  });

  it("recognises --help", () => {
    expect(parseEnrollArgs(["--help"]).help).toBe(true);
  });
});
