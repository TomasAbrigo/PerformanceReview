import { describe, expect, it } from "vitest";
import { INITIAL_THEMES, initialThemeRows } from "./themes";

describe("initial theme vocabulary", () => {
  it("has the eight themes People uses, as normalized keys", () => {
    expect([...INITIAL_THEMES]).toEqual([
      "proyecto",
      "equipo",
      "comunicacion",
      "crecimiento",
      "cultura",
      "procesos",
      "bienestar",
      "reconocimiento",
    ]);
  });
  it("one catalog row per dimension and theme, deduplicated", () => {
    const rows = initialThemeRows(["strengths", "valued", "strengths"]);
    expect(rows).toHaveLength(2 * INITIAL_THEMES.length);
    expect(rows).toContainEqual({
      dimension: "valued",
      name: "bienestar",
    });
  });
});
