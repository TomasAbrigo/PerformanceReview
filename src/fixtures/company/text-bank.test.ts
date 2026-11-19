import { describe, expect, it } from "vitest";
import { FIRST_NAMES } from "./catalog";
import {
  INITIATIVES,
  LANGS,
  QUESTIONS,
  SIDES,
  SIGNALS,
  SUBSTANCES,
  TEXT_BANK,
  THEMES,
  TONES,
  type BankEntry,
} from "./text-bank";

const share = (count: number, total: number): number => count / total;

const groups = new Map<string, BankEntry[]>();
for (const entry of TEXT_BANK) {
  const key = `${entry.question}/${entry.side}`;
  groups.set(key, [...(groups.get(key) ?? []), entry]);
}

const IMPACT = ["social_impact", "environmental_impact"];

describe("text bank: vocabulary", () => {
  it("only uses keys of the fixed vocabulary", () => {
    for (const entry of TEXT_BANK) {
      const { substance, themes, signals, tone } = entry.expected;
      expect(QUESTIONS, entry.text).toContain(entry.question);
      expect(SIDES, entry.text).toContain(entry.side);
      expect(LANGS, entry.text).toContain(entry.lang);
      expect(SUBSTANCES, entry.text).toContain(substance);
      expect(TONES, entry.text).toContain(tone);
      for (const signal of signals)
        expect(SIGNALS, entry.text).toContain(signal);
      // the "how" of the impact questions names initiative types, the rest themes
      const vocabulary: readonly string[] = IMPACT.includes(entry.question)
        ? INITIATIVES
        : THEMES;
      for (const theme of themes)
        expect(vocabulary, entry.text).toContain(theme);
      expect(themes.length, entry.text).toBeLessThanOrEqual(3);
      expect(new Set(themes).size, entry.text).toBe(themes.length);
      expect(new Set(signals).size, entry.text).toBe(signals.length);
    }
  });

  it("covers every theme, initiative, signal and tone", () => {
    const count = (values: string[]) =>
      values.reduce(
        (all, v) => all.set(v, (all.get(v) ?? 0) + 1),
        new Map<string, number>(),
      );
    const themes = count(TEXT_BANK.flatMap((e) => e.expected.themes));
    for (const theme of [...THEMES, ...INITIATIVES]) {
      expect(themes.get(theme) ?? 0, theme).toBeGreaterThanOrEqual(3);
    }
    const signals = count(TEXT_BANK.flatMap((e) => e.expected.signals));
    for (const signal of SIGNALS) {
      expect(signals.get(signal) ?? 0, signal).toBeGreaterThanOrEqual(3);
    }
    const tones = count(TEXT_BANK.map((e) => e.expected.tone));
    for (const tone of TONES) {
      expect(tones.get(tone) ?? 0, tone).toBeGreaterThanOrEqual(3);
    }
  });

  it("reads a text with no substance as no themes and no signals", () => {
    for (const entry of TEXT_BANK) {
      if (entry.expected.substance !== "none") continue;
      expect(entry.expected.themes, entry.text).toEqual([]);
      expect(entry.expected.signals, entry.text).toEqual([]);
    }
  });

  it("gives a specific text at least one theme", () => {
    for (const entry of TEXT_BANK) {
      if (entry.expected.substance !== "specific") continue;
      expect(entry.expected.themes.length, entry.text).toBeGreaterThan(0);
    }
  });
});

describe("text bank: texts", () => {
  it("has at least 200 distinct texts, none repeated", () => {
    expect(TEXT_BANK.length).toBeGreaterThanOrEqual(200);
    const normalized = TEXT_BANK.map((e) =>
      e.text.trim().replace(/\s+/g, " ").toLowerCase(),
    );
    expect(new Set(normalized).size).toBe(TEXT_BANK.length);
  });

  it("has no empty text, no e-mail address and no bare yes/no", () => {
    for (const { text } of TEXT_BANK) {
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toMatch(/@|https?:/);
      // a bare "Sí" / "No" is generated, not banked
      expect(text).not.toMatch(/^\s*(s[ií]|yes|no)\s*[.!]?\s*$/i);
    }
  });

  it("is about 15 % English, in every question and side", () => {
    const english = TEXT_BANK.filter((e) => e.lang === "en").length;
    expect(share(english, TEXT_BANK.length)).toBeGreaterThanOrEqual(0.12);
    expect(share(english, TEXT_BANK.length)).toBeLessThanOrEqual(0.2);
    for (const [key, entries] of groups) {
      const inGroup = entries.filter((e) => e.lang === "en").length;
      expect(inGroup, key).toBeGreaterThanOrEqual(3);
      expect(share(inGroup, entries.length), key).toBeLessThanOrEqual(0.2);
    }
  });

  it("covers the five questions, the employee and the manager side", () => {
    expect([...groups.keys()].sort()).toEqual(
      [
        "best_work_other/self",
        "environmental_impact/self",
        "improvement/manager",
        "improvement/self",
        "social_impact/self",
        "strengths/manager",
        "strengths/self",
      ].sort(),
    );
  });

  it("names a colleague by first name only in a few texts, and only from the catalog", () => {
    const named = TEXT_BANK.filter((e) =>
      FIRST_NAMES.some((name) => e.text.includes(name)),
    );
    expect(named.length).toBeGreaterThanOrEqual(3);
    expect(named.length).toBeLessThanOrEqual(12);
  });
});

describe("text bank: mix of readings", () => {
  it.each([...groups])(
    "%s: 55-65 % specific, 25-35 % generic, 5-10 % none",
    (_key, entries) => {
      const of = (substance: string) =>
        share(
          entries.filter((e) => e.expected.substance === substance).length,
          entries.length,
        );
      expect(of("specific")).toBeGreaterThanOrEqual(0.55);
      expect(of("specific")).toBeLessThanOrEqual(0.65);
      expect(of("generic")).toBeGreaterThanOrEqual(0.25);
      expect(of("generic")).toBeLessThanOrEqual(0.35);
      expect(of("none")).toBeGreaterThanOrEqual(0.05);
      expect(of("none")).toBeLessThanOrEqual(0.1);
    },
  );

  it("carries each signal in 2-6 % of the texts", () => {
    for (const signal of SIGNALS) {
      const withSignal = TEXT_BANK.filter((e) =>
        e.expected.signals.includes(signal),
      ).length;
      const fraction = share(withSignal, TEXT_BANK.length);
      expect(fraction, signal).toBeGreaterThanOrEqual(0.02);
      expect(fraction, signal).toBeLessThanOrEqual(0.06);
    }
  });

  it("keeps signals out of the texts that say nothing, and mostly in improvement and the open 'Other'", () => {
    const flagged = TEXT_BANK.filter((e) => e.expected.signals.length > 0);
    const where = flagged.filter((e) =>
      ["improvement", "best_work_other"].includes(e.question),
    );
    expect(share(where.length, flagged.length)).toBeGreaterThan(0.6);
  });

  it("has a few answers posted under the other impact question", () => {
    const environmental = ["reciclaje", "consumo", "movilidad"];
    const social = ["donaciones", "educacion"];
    const underSocial = TEXT_BANK.filter(
      (e) =>
        e.question === "social_impact" &&
        e.expected.themes.some((t) => environmental.includes(t)) &&
        !e.expected.themes.some((t) => social.includes(t)),
    );
    const underEnvironmental = TEXT_BANK.filter(
      (e) =>
        e.question === "environmental_impact" &&
        e.expected.themes.some((t) => social.includes(t)) &&
        !e.expected.themes.some((t) => environmental.includes(t)),
    );
    expect(underSocial.length).toBeGreaterThanOrEqual(1);
    expect(underEnvironmental.length).toBeGreaterThanOrEqual(1);
  });
});

describe("text bank: yes/no questions", () => {
  const yesNo = TEXT_BANK.filter((e) => IMPACT.includes(e.question));

  it("starts every answer with a yes or a no word", () => {
    expect(yesNo.length).toBeGreaterThan(0);
    for (const entry of yesNo) {
      expect(entry.text, entry.text).toMatch(/^(s[ií]|yes|no)(?![\p{L}])/iu);
    }
  });

  it("reads the yes or no from how the answer starts", () => {
    for (const entry of yesNo) {
      const startsWithNo = /^no(?![\p{L}])/iu.test(entry.text);
      expect(entry.expected.yesNo, entry.text).toBe(
        startsWithNo ? "no" : "yes",
      );
    }
  });

  it("reads a no as no substance, and has a few of them", () => {
    const noes = yesNo.filter((e) => e.expected.yesNo === "no");
    expect(noes.length).toBeGreaterThanOrEqual(2);
    for (const entry of noes) {
      expect(entry.expected.substance, entry.text).toBe("none");
    }
  });

  it("writes English answers with Yes and Spanish ones with Sí or Si", () => {
    for (const entry of yesNo) {
      if (entry.expected.yesNo !== "yes") continue;
      expect(entry.text, entry.text).toMatch(
        entry.lang === "en" ? /^yes/i : /^s[ií]/i,
      );
    }
  });

  it("gives no yes/no to the other questions", () => {
    for (const entry of TEXT_BANK) {
      if (IMPACT.includes(entry.question)) continue;
      expect(entry.expected.yesNo, entry.text).toBeUndefined();
    }
  });
});
