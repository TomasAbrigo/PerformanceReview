import { describe, expect, it } from "vitest";
import { optionCountOf } from "./likert-reapply";

describe("optionCountOf (#132)", () => {
  it("is the declared count, never inferred from the letters answered", () => {
    expect(optionCountOf(["A", "B", "C", "D"], 5)).toBe(5);
    expect(optionCountOf(["A", "B"], 4)).toBe(4);
  });
  it("defaults to 5 without a declared count", () => {
    expect(optionCountOf(["A", "D"], undefined)).toBe(5);
  });
});
