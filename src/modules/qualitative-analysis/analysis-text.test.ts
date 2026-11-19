import { describe, expect, it } from "vitest";
import { isYesNo } from "./analysis-text";

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
