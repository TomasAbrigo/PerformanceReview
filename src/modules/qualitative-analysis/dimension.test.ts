import { describe, expect, it } from "vitest";
import { dimensionOf } from "./dimension";

const p = (es: string, en = es) => ({ prompt: { es, en } });

describe("dimensionOf", () => {
  it("maps the strengths and improvement questions in both languages", () => {
    expect(dimensionOf(p("What are some things I do well?"))).toBe("strengths");
    expect(dimensionOf(p("What are some things [Employee] does well?"))).toBe(
      "strengths",
    );
    expect(dimensionOf(p("¿Qué cosas hago bien?"))).toBe("strengths");
    expect(dimensionOf(p("How could [Employee] improve?"))).toBe("improvement");
    expect(dimensionOf(p("¿Qué podría mejorar?"))).toBe("improvement");
  });
  it("maps the closed questions Bamboo asks, when the column is not set", () => {
    expect(
      dimensionOf(p("Employee - How well does [Company] recognize my value?")),
    ).toBe("valued");
    expect(dimensionOf(p("¿Qué tan bien se reconoce mi valor?"))).toBe(
      "valued",
    );
    expect(
      dimensionOf(p("Employee - What would help me do my best work?")),
    ).toBe("best_work");
    expect(dimensionOf(p("¿Qué me ayudaría a hacer mi mejor trabajo?"))).toBe(
      "best_work",
    );
  });
  it("custom questions get custom_<n>, anything else other", () => {
    expect(dimensionOf(p("Custom Q2: algo"))).toBe("custom_2");
    expect(dimensionOf(p("Comentarios generales"))).toBe("other");
  });
  it("prefers the real column when present", () => {
    expect(dimensionOf({ ...p("x"), dimension: "culture" })).toBe("culture");
  });
});
