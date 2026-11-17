import { describe, expect, it } from "vitest";
import { parseSeedArgs } from "./seed";

describe("parseSeedArgs", () => {
  it("defaults to the small size without reset", () => {
    expect(parseSeedArgs([])).toEqual({
      size: "small",
      reset: false,
      reports: true,
      analysis: true,
    });
  });

  it("reads --size and --reset", () => {
    expect(parseSeedArgs(["--size", "demo", "--reset"])).toEqual({
      size: "demo",
      reset: true,
      reports: true,
      analysis: true,
    });
    expect(parseSeedArgs(["--size=small"])).toEqual({
      size: "small",
      reset: false,
      reports: true,
      analysis: true,
    });
  });

  it("reads --no-reports and --no-analysis", () => {
    expect(parseSeedArgs(["--no-reports", "--no-analysis"])).toEqual({
      size: "small",
      reset: false,
      reports: false,
      analysis: false,
    });
  });

  it("rejects an unknown size, an unknown flag and stray arguments", () => {
    expect(() => parseSeedArgs(["--size", "huge"])).toThrow(
      "--size must be small or demo (got huge)",
    );
    expect(() => parseSeedArgs(["--wipe"])).toThrow();
    expect(() => parseSeedArgs(["small"])).toThrow();
  });
});
