import { describe, expect, it } from "vitest";
import { FIXTURE_SEEDS } from "../write";
import { generateCompany } from "./index";
import { SIGNALS, TEXT_BANK, type BankEntry } from "./text-bank";
import { lowness, namesIn } from "./texts";

const small = generateCompany({ size: "small", seed: FIXTURE_SEEDS.small });
const demo = generateCompany({ size: "demo", seed: FIXTURE_SEEDS.demo });

const byText = new Map<string, BankEntry>(
  TEXT_BANK.map((e) => [`${e.question}|${e.side}|${e.text}`, e]),
);
const BARE = /^(S[ií]|Yes|No)$/;

interface Drawn {
  entry: BankEntry;
  low: number;
}

/** What the generator wrote in the open answers, looked up in the bank. */
function drawn(company: typeof demo) {
  const all: Drawn[] = [];
  const pairs: { self: BankEntry[]; manager: BankEntry[] }[] = [];
  const unknown: string[] = [];
  let bare = 0;
  for (const a of company.assessments) {
    const { selfAnswers: s, managerAnswers: m } = a;
    if (!s && !m) continue;
    const low = lowness(s, m);
    const read = (
      question: string,
      side: string,
      text: string | undefined,
    ): BankEntry | undefined => {
      if (text === undefined) return undefined;
      const entry = byText.get(`${question}|${side}|${text}`);
      if (entry) all.push({ entry, low });
      else if (BARE.test(text)) bare++;
      else unknown.push(text);
      return entry;
    };
    const mine = [
      read("strengths", "self", s?.q3),
      read("improvement", "self", s?.q4),
    ];
    const theirs = [
      read("strengths", "manager", m?.q3),
      read("improvement", "manager", m?.q4),
    ];
    read("social_impact", "self", s?.socialImpact);
    read("environmental_impact", "self", s?.environmentalImpact);
    if (s?.q2 === "E") read("best_work_other", "self", s.bestWorkOther);
    if (s && m) {
      pairs.push({
        self: mine.filter((e): e is BankEntry => !!e),
        manager: theirs.filter((e): e is BankEntry => !!e),
      });
    }
  }
  return { all, pairs, unknown, bare };
}

const demoDrawn = drawn(demo);
const smallDrawn = drawn(small);

describe("texts drawn from the bank", () => {
  it.each([
    ["small", smallDrawn],
    ["demo", demoDrawn],
  ])("%s: every open answer is a bank text or a bare yes/no", (_, d) => {
    expect(d.unknown).toEqual([]);
    expect(d.all.length).toBeGreaterThan(100);
    expect(d.bare).toBeGreaterThan(0);
  });

  it("is deterministic: same seed, same assessments", () => {
    const again = generateCompany({ size: "small", seed: FIXTURE_SEEDS.small });
    expect(again.assessments).toEqual(small.assessments);
  });

  it("writes the Other text only for those who picked Other", () => {
    for (const a of demo.assessments) {
      const s = a.selfAnswers;
      if (!s) continue;
      expect(s.bestWorkOther !== undefined, `${a.employeeId}`).toBe(
        s.q2 === "E",
      );
    }
    expect(
      demo.assessments.filter((a) => a.selfAnswers?.q2 === "E").length,
    ).toBeGreaterThan(50);
  });

  it("is varied: the demo uses nearly the whole bank, the small one most of it", () => {
    const distinct = (d: ReturnType<typeof drawn>) =>
      new Set(d.all.map((x) => x.entry.text)).size;
    expect(distinct(demoDrawn)).toBeGreaterThanOrEqual(200);
    expect(distinct(smallDrawn)).toBeGreaterThanOrEqual(150);
  });

  it("never repeats a text to the same person in two cycles in a row", () => {
    const last = new Map<string, string>();
    for (const a of demo.assessments) {
      const s = a.selfAnswers;
      if (!s || a.employeeId === null) continue;
      for (const [slot, text] of [
        ["q3", s.q3],
        ["q4", s.q4],
      ] as const) {
        const key = `${a.employeeId}|${slot}`;
        expect(text, key).not.toBe(last.get(key));
        last.set(key, text);
      }
    }
  });

  it("mixes substance as the bank does: mostly specific, some generic, a few empty", () => {
    const count = (substance: string) =>
      demoDrawn.all.filter((x) => x.entry.expected.substance === substance)
        .length / demoDrawn.all.length;
    expect(count("specific")).toBeGreaterThan(0.5);
    expect(count("specific")).toBeLessThan(0.7);
    expect(count("generic")).toBeGreaterThan(0.25);
    expect(count("none")).toBeGreaterThan(0.03);
    expect(count("none")).toBeLessThan(0.12);
  });

  it("writes about 15 % of the texts in English", () => {
    const english =
      demoDrawn.all.filter((x) => x.entry.lang === "en").length /
      demoDrawn.all.length;
    expect(english).toBeGreaterThan(0.1);
    expect(english).toBeLessThan(0.2);
  });

  it("carries each signal in a few answers (2-6 %)", () => {
    for (const signal of SIGNALS) {
      const share =
        demoDrawn.all.filter((x) => x.entry.expected.signals.includes(signal))
          .length / demoDrawn.all.length;
      expect(share, signal).toBeGreaterThanOrEqual(0.015);
      expect(share, signal).toBeLessThanOrEqual(0.06);
    }
  });

  it("makes signals likelier when the closed answers are low", () => {
    const rate = (keep: (low: number) => boolean) => {
      const some = demoDrawn.all.filter((x) => keep(x.low));
      return (
        some.filter((x) => x.entry.expected.signals.length > 0).length /
        some.length
      );
    };
    expect(rate((low) => low >= 0.5)).toBeGreaterThan(
      2 * rate((low) => low <= 0.2),
    );
  });

  it("makes employee and manager share a theme in about half of the assessments", () => {
    const themes = (entries: BankEntry[]) =>
      new Set(entries.flatMap((e) => e.expected.themes));
    const shared = demoDrawn.pairs.filter((p) => {
      const mine = themes(p.self);
      return [...themes(p.manager)].some((t) => mine.has(t));
    }).length;
    const fraction = shared / demoDrawn.pairs.length;
    expect(fraction).toBeGreaterThan(0.4);
    expect(fraction).toBeLessThan(0.65);
  });

  it("names a colleague only when the company has someone with that first name", () => {
    for (const company of [small, demo]) {
      const names = new Set(company.employees.map((e) => e.firstName));
      for (const a of company.assessments) {
        for (const answers of [a.selfAnswers, a.managerAnswers]) {
          if (!answers) continue;
          for (const text of [answers.q3, answers.q4]) {
            for (const name of namesIn(text)) expect(names).toContain(name);
          }
        }
      }
    }
    // ... and the demo does use a few of those names
    const named = demoDrawn.all.filter(
      (x) => namesIn(x.entry.text).length > 0,
    ).length;
    expect(named).toBeGreaterThan(0);
  });
});
