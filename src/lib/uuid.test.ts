import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("accepts canonical UUIDs in any case", () => {
    expect(isUuid("3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b")).toBe(true);
    expect(isUuid("3F2B8C1E-5A4D-4E6F-9A0B-1C2D3E4F5A6B")).toBe(true);
  });

  it("rejects what Postgres would refuse as a uuid", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("101")).toBe(false);
    // 36 characters of the right alphabet but not the 8-4-4-4-12 shape.
    expect(isUuid("-".repeat(36))).toBe(false);
    expect(isUuid("3f2b8c1e5a4d4e6f9a0b1c2d3e4f5a6b0000")).toBe(false);
    expect(isUuid("3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6g")).toBe(false);
    expect(isUuid("3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b ")).toBe(false);
  });
});
