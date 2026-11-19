import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "./en.json";
import es from "./es.json";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("i18n messages", () => {
  it("es and en define exactly the same keys", () => {
    expect(keyPaths(en).sort()).toEqual(keyPaths(es).sort());
  });
});

describe("goal and progress labels say what they count (#131)", () => {
  it("the home's pending tile uses the word of the assessments' chip, not 'Sin empezar'", () => {
    // The tile counts the people with no assessment submitted (what the chip
    // it links to lists), and some of them have one in progress.
    const word = (home: string, chip: string) => home.startsWith(chip);
    expect(word(es.Home.signal.pending, es.Assessments.progress.pending)).toBe(
      true,
    );
    expect(word(en.Home.signal.pending, en.Assessments.progress.pending)).toBe(
      true,
    );
    expect(JSON.stringify(es.Home)).not.toMatch(/Sin empezar/);
    expect(JSON.stringify(en.Home)).not.toMatch(/Not started/);
  });

  it("the overdue help text names the cut-off date, not the end of the period", () => {
    for (const hint of [
      es.GoalsInsights.kpis.hint,
      en.GoalsInsights.kpis.hint,
    ]) {
      expect(hint).toContain("{date}");
      expect(hint).not.toMatch(
        /fin del período|period ended|end of the period/,
      );
    }
    // It says which date it is and whether that is today or the cycle's close.
    const t = createTranslator({
      locale: "es",
      messages: es,
      namespace: "GoalsInsights.kpis",
    });
    expect(t("hint", { date: "28 sept 2026", live: "false" })).toContain(
      "anterior al 28 sept 2026 (el cierre del ciclo)",
    );
    expect(t("hint", { date: "19 nov 2026", live: "true" })).toContain(
      "anterior al 19 nov 2026 (hoy)",
    );
    // In progress and overdue are told apart: the bar's legend is "En curso".
    expect(es.GoalsInsights.kpis).not.toHaveProperty("legendOnTime");
    expect(en.GoalsInsights.kpis).not.toHaveProperty("legendOnTime");
  });
});
