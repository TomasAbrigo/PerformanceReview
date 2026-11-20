import { describe, expect, it } from "vitest";
import { choiceOfValue } from "./choices";

const letters = ["A", "B", "C", "D", "E"].map((value) => ({
  value,
  label: { es: `es ${value}`, en: `en ${value}` },
}));

describe("choiceOfValue", () => {
  it("maps 5..1 to the letter choices A..E", () => {
    expect(choiceOfValue(letters, 5)?.value).toBe("A");
    expect(choiceOfValue(letters, 4)?.value).toBe("B");
    expect(choiceOfValue(letters, 1)?.value).toBe("E");
  });
  it("prefers a choice whose value is the number", () => {
    const numeric = [1, 2, 3, 4].map((v) => ({
      value: String(v),
      label: { es: `v${v}`, en: `v${v}` },
    }));
    expect(choiceOfValue(numeric, 3)?.label.es).toBe("v3");
  });
  it("is null outside the scale or without choices", () => {
    expect(choiceOfValue(letters, 6)).toBeNull();
    expect(choiceOfValue(letters, 0)).toBeNull();
    expect(choiceOfValue(null, 3)).toBeNull();
  });
});
