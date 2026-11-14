import { describe, expect, it } from "vitest";
import { parseSeedArgs } from "./seed";

describe("parseSeedArgs", () => {
  it("defaults to the small size without reset", () => {
    expect(parseSeedArgs([])).toEqual({ size: "small", reset: false });
  });

  it("reads --size and --reset", () => {
    expect(parseSeedArgs(["--size", "demo", "--reset"])).toEqual({
      size: "demo",
      reset: true,
    });
    expect(parseSeedArgs(["--size=small"])).toEqual({
      size: "small",
      reset: false,
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
