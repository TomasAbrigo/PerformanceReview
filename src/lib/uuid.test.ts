import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("accepts RFC 4122 uuids in any case", () => {
    expect(isUuid("0b9ec3f0-9c4a-4a1e-8f0d-6f2f4f0d9a11")).toBe(true);
    expect(isUuid("00000000-0000-4000-8000-000000000000")).toBe(true);
    expect(isUuid("0B9EC3F0-9C4A-4A1E-8F0D-6F2F4F0D9A11")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("-".repeat(36))).toBe(false);
    expect(isUuid("0b9ec3f0-9c4a-4a1e-8f0d-6f2f4f0d9a11 ")).toBe(false);
    expect(isUuid("0b9ec3f0-9c4a-0a1e-8f0d-6f2f4f0d9a11")).toBe(false); // version 0
    expect(isUuid("0b9ec3f0-9c4a-4a1e-cf0d-6f2f4f0d9a11")).toBe(false); // variant c
  });
});
