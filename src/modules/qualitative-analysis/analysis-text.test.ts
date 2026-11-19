import { describe, expect, it } from "vitest";
import { isYesNo, parseYesNo } from "./analysis-text";
import { YES_NO_CASES } from "./yes-no-cases";

describe("isYesNo", () => {
  it("a bare yes or no, in Spanish or English, is not a comment", () => {
    for (const t of ["Sí", "si", "SI.", " No ", "no!", "Yes", "yes."]) {
      expect(isYesNo(t)).toBe(true);
    }
  });

  it("a yes with a reason, or anything else, is", () => {
    for (const t of [
      "Sí, participé en la campaña de donaciones.",
      "No por ahora.",
      "Nothing, I have all I need.",
      "",
    ]) {
      expect(isYesNo(t)).toBe(false);
    }
  });
});

describe("parseYesNo", () => {
  it.each(YES_NO_CASES)("%j", (text, expected) => {
    expect(parseYesNo(text)).toEqual(expected);
  });

  it("null and undefined read as nothing", () => {
    expect(parseYesNo(null)).toEqual({ answer: null, detail: null });
    expect(parseYesNo(undefined)).toEqual({ answer: null, detail: null });
  });
});
