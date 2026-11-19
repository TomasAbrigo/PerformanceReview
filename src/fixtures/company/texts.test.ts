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

/**
 * A participant is a person in a cycle: what the signals say about the
 * answers of both sides (the unit the Signals screen counts), with the
 * "other" text of the best work counted as the person's own.
 */
interface Participant {
  cycle: number;
  low: number;
  own: Set<string>;
  manager: Set<string>;
}

function participants(company: typeof demo): Participant[] {
  const signalsOf = (
    question: string,
    side: string,
    text: string | undefined,
  ): string[] =>
    text === undefined
      ? []
      : (byText.get(`${question}|${side}|${text}`)?.expected.signals ?? []);
  const people: Participant[] = [];
  for (const a of company.assessments) {
    const { selfAnswers: s, managerAnswers: m } = a;
    if (a.employeeId === null || (!s && !m)) continue;
    people.push({
      cycle: a.cycle,
      low: lowness(s, m),
      own: new Set([
        ...signalsOf("strengths", "self", s?.q3),
        ...signalsOf("improvement", "self", s?.q4),
        ...(s?.q2 === "E"
          ? signalsOf("best_work_other", "self", s.bestWorkOther)
          : []),
      ]),
      manager: new Set([
        ...signalsOf("strengths", "manager", m?.q3),
        ...signalsOf("improvement", "manager", m?.q4),
      ]),
    });
  }
  return people;
}

const carries = (p: Participant, signal: string) =>
  p.own.has(signal) || p.manager.has(signal);
const anySignal = (p: Participant) => p.own.size + p.manager.size > 0;
const demoPeople = participants(demo);

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

  describe("signals are the short list of people, not the majority", () => {
    const cycleShare = (
      cycle: number,
      keep: (p: Participant) => boolean,
      of: (p: Participant) => boolean = () => true,
    ) => {
      const some = demoPeople.filter((p) => p.cycle === cycle && of(p));
      return some.filter(keep).length / some.length;
    };
    const cycles = [...new Set(demoPeople.map((p) => p.cycle))];

    it("has a few people with a signal in every cycle (15-22 %)", () => {
      expect(cycles.length).toBeGreaterThanOrEqual(5);
      for (const cycle of cycles) {
        const share = cycleShare(cycle, anySignal);
        expect(share, `cycle ${cycle}`).toBeGreaterThanOrEqual(0.15);
        expect(share, `cycle ${cycle}`).toBeLessThanOrEqual(0.22);
      }
    });

    it("carries each signal in 2-6 % of the people of a cycle", () => {
      for (const cycle of cycles) {
        for (const signal of SIGNALS) {
          const share = cycleShare(cycle, (p) => carries(p, signal));
          expect(share, `cycle ${cycle} ${signal}`).toBeGreaterThanOrEqual(
            0.02,
          );
          expect(share, `cycle ${cycle} ${signal}`).toBeLessThanOrEqual(0.06);
        }
      }
    });

    it("makes company requests the most frequent signal and attrition and conflict the rarest", () => {
      const overall = Object.fromEntries(
        SIGNALS.map((signal) => [
          signal,
          demoPeople.filter((p) => carries(p, signal)).length /
            demoPeople.length,
        ]),
      );
      const others = SIGNALS.filter((s) => s !== "company_request");
      for (const signal of others) {
        expect(overall.company_request, signal).toBeGreaterThan(
          overall[signal],
        );
      }
      const rarest = Object.values(overall).sort((a, b) => a - b);
      expect(overall.attrition).toBeLessThanOrEqual(rarest[2]);
      expect(overall.conflict).toBeLessThanOrEqual(rarest[2]);
      expect(overall.attrition).toBeLessThanOrEqual(0.035);
      expect(overall.conflict).toBeLessThanOrEqual(0.035);
    });

    it("follows the closed answers without being deterministic: ~45-60 % of the lowest band, at most 8 % of the highest", () => {
      for (const cycle of cycles) {
        const bands = {
          lowest: demoPeople.filter((p) => p.cycle === cycle && p.low >= 0.5),
          middle: demoPeople.filter(
            (p) => p.cycle === cycle && p.low > 0.2 && p.low < 0.5,
          ),
          highest: demoPeople.filter((p) => p.cycle === cycle && p.low <= 0.2),
        };
        const rate = (band: Participant[]) =>
          band.filter(anySignal).length / band.length;
        for (const [name, band] of Object.entries(bands)) {
          if (band.length < 10) continue;
          expect(rate(band), `cycle ${cycle} ${name}`).toBeGreaterThan(0);
          expect(rate(band), `cycle ${cycle} ${name}`).toBeLessThan(1);
        }
        expect(bands.lowest.length, `cycle ${cycle}`).toBeGreaterThanOrEqual(
          10,
        );
        expect(rate(bands.lowest), `cycle ${cycle} lowest`).toBeGreaterThan(
          0.45,
        );
        expect(rate(bands.lowest), `cycle ${cycle} lowest`).toBeLessThan(0.6);
        expect(rate(bands.highest), `cycle ${cycle} highest`).toBeLessThan(
          0.08,
        );
        expect(rate(bands.middle), `cycle ${cycle} middle`).toBeLessThan(
          rate(bands.lowest),
        );
      }
    });

    it("sees stagnation, role fit and recognition more in the person's own answers, conflict and attrition slightly more in the manager's", () => {
      const sides = (signal: (typeof SIGNALS)[number]) => ({
        own: demoPeople.filter((p) => p.own.has(signal)).length,
        manager: demoPeople.filter((p) => p.manager.has(signal)).length,
      });
      for (const signal of ["stagnation", "role_fit", "recognition"] as const) {
        const { own, manager } = sides(signal);
        expect(own, signal).toBeGreaterThan(manager);
      }
      for (const signal of ["conflict", "attrition"] as const) {
        const { own, manager } = sides(signal);
        expect(manager, signal).toBeGreaterThan(own);
        expect(own / (own + manager), signal).toBeGreaterThan(0.3);
      }
      const workload = sides("workload");
      const own = workload.own / (workload.own + workload.manager);
      expect(own).toBeGreaterThan(0.35);
      expect(own).toBeLessThan(0.65);
    });
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
