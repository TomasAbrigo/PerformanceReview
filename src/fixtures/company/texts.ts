import { FIRST_NAMES } from "./catalog";
import { createRng, type Rng } from "./rng";
import {
  SIGNALS,
  TEXT_BANK,
  type BankEntry,
  type BankLang,
  type BankQuestion,
  type BankSide,
  type Signal,
} from "./text-bank";
import type {
  AssessmentAnswers,
  FixtureAssessment,
  FixtureEmployee,
} from "./types";

/**
 * Fills the open texts of the assessments from the text bank (issue #127).
 *
 * It runs after the reviews are built, with a stream of its own, so the
 * choice of texts never moves a person, a date, a status or a goal; same
 * seed, same texts.
 *
 * - A form is written in one language (about 15 % in English).
 * - The signals of the bank (overload, intent to leave...) are the short list
 *   of people to attend, not the majority: about one person in five carries
 *   one in the open answers of a cycle, each signal 2-6 % of the people.
 *   They turn up more when the participant's closed answers are low
 *   ("valued" of the employee, retention and engagement of the manager)
 *   without being certain: roughly half of the lowest band, a few of the
 *   highest. See `chooseCarriers` (who), `SIGNAL_SHARE` (which signal) and
 *   `OWN_SHARE` (whose answer).
 * - Employee and manager share a theme in about half of the assessments, in
 *   strengths and in improvement alike: the rest are on different topics
 *   (agreement and blind spots are neither always nor never).
 * - A "yes/no and how" question is a bare "Sí"/"No" half of the time.
 */

const ENGLISH_SHARE = 0.15;
/** Of the assessments with both sides, those whose texts share a theme. */
const ALIGNED_SHARE = 0.55;
const BARE_SHARE = 0.5;
/** Mixed into the seed so this stream is not the generator's. */
const STREAM_SALT = 0x7e47a3;

/** 0 (best) to 1 (worst) of one closed answer, from its letter. */
const worst = (letter: string, letters: string): number =>
  Math.max(0, letters.indexOf(letter)) / (letters.length - 1);

/**
 * How low the participant's closed answers are, 0 to 1: the average of what
 * is known (employee "valued", manager retention and engagement).
 */
export function lowness(
  self: AssessmentAnswers | null,
  manager: AssessmentAnswers | null,
): number {
  const known: number[] = [];
  if (self) known.push(worst(self.q1, "ABCD"));
  if (manager) {
    known.push(worst(manager.q1, "ABCDE"), worst(manager.q2, "ABCDE"));
  }
  return known.length === 0
    ? 0
    : known.reduce((sum, v) => sum + v, 0) / known.length;
}

/**
 * Who carries a signal in the open answers. Every cycle has about the same
 * share of its participants with one (`CARRY_SHARE`: the short list People
 * must act on, one in five, not the majority), and how low the closed answers
 * are decides who: the odds are a logistic of lowness with a floor (a signal
 * is never certain and never impossible), and most people answer in the upper
 * half, so the few who are really low are the ones who say it.
 */
const CARRY_SHARE = 0.186;
const CARRY_FLOOR = 0.05;
const CARRY_MIDPOINT = 0.55;
const CARRY_STEEPNESS = 12;

const carryOdds = (low: number): number =>
  CARRY_FLOOR +
  (1 - CARRY_FLOOR) / (1 + Math.exp(-CARRY_STEEPNESS * (low - CARRY_MIDPOINT)));

/**
 * The indexes of the assessments whose participant carries a signal. In every
 * cycle and at every level of lowness (to a tenth) the number of people is
 * the expected one (the odds added up, the fraction rounded at random) and
 * who they are is drawn at random: a cycle does not get a lucky or an unlucky
 * short list.
 */
function chooseCarriers(
  rng: Rng,
  assessments: readonly FixtureAssessment[],
): Set<number> {
  const byCycle = new Map<number, { index: number; low: number }[]>();
  assessments.forEach(({ cycle, selfAnswers, managerAnswers }, index) => {
    if (!selfAnswers && !managerAnswers) return;
    const low = lowness(selfAnswers, managerAnswers);
    byCycle.set(cycle, [...(byCycle.get(cycle) ?? []), { index, low }]);
  });
  const carriers = new Set<number>();
  for (const participants of byCycle.values()) {
    const total = participants.reduce((sum, p) => sum + carryOdds(p.low), 0);
    const scale = (CARRY_SHARE * participants.length) / total;
    const strata = new Map<number, { chance: number; members: number[] }>();
    for (const { index, low } of participants) {
      const stratum = strata.get(Math.round(low * 10)) ?? {
        chance: 0,
        members: [],
      };
      stratum.chance += Math.min(1, scale * carryOdds(low));
      stratum.members.push(index);
      strata.set(Math.round(low * 10), stratum);
    }
    for (const { chance, members } of strata.values()) {
      const count = Math.floor(chance) + (rng.chance(chance % 1) ? 1 : 0);
      for (const index of rng.shuffle(members).slice(0, count)) {
        carriers.add(index);
      }
    }
  }
  return carriers;
}

/**
 * Of the people who carry a signal, how many carry each (a bit over 100 in
 * all: a text that says two things counts for both). Company requests are
 * the most frequent; attrition and conflict the rarest. The weight is of the
 * signal, not of the bank's texts, so the mix does not depend on how many
 * texts each one has.
 */
const SIGNAL_SHARE: Record<Signal, number> = {
  workload: 15,
  attrition: 13,
  conflict: 13,
  recognition: 14,
  stagnation: 14,
  company_request: 17,
  role_fit: 14,
};

/**
 * Of the people who carry a signal, how many show it in their own answers
 * rather than in their manager's. Stagnation, role fit and recognition are
 * what people say about themselves more than what a manager notices;
 * conflict and attrition the manager sees a little more; workload is on
 * either side.
 */
const OWN_SHARE: Record<Signal, number> = {
  workload: 0.5,
  attrition: 0.4,
  conflict: 0.36,
  recognition: 0.65,
  stagnation: 0.7,
  company_request: 0.55,
  role_fit: 0.65,
};

/** How often a signal is in this answer rather than in another one of the form. */
const SLOT_WEIGHT: Partial<Record<BankQuestion, number>> = {
  strengths: 0.25,
  improvement: 1,
  best_work_other: 0.4,
};

const NAME_PATTERNS = FIRST_NAMES.map(
  (name) =>
    [name, new RegExp(`(?<![\\p{L}])${name}(?![\\p{L}])`, "u")] as const,
);

/** The first names of the catalog a text mentions. */
export function namesIn(text: string): string[] {
  return NAME_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
    ([name]) => name,
  );
}

const hasSignal = (entry: BankEntry): boolean =>
  entry.expected.signals.length > 0;

const shares = (entry: BankEntry, themes: readonly string[]): boolean =>
  entry.expected.themes.some((theme) => themes.includes(theme));

interface Relation {
  themes: readonly string[];
  shared: boolean;
}

/**
 * The candidates that say a signal. A text that says two things counts for
 * both: it is used only when no text says just this one, or the share of its
 * other signal would grow.
 */
function sayingSignal(
  candidates: readonly BankEntry[],
  signal: Signal,
): readonly BankEntry[] {
  const saying = candidates.filter((entry) =>
    entry.expected.signals.includes(signal),
  );
  const only = saying.filter((entry) => entry.expected.signals.length === 1);
  return only.length > 0 ? only : saying;
}

/**
 * One of the candidates: a text that says `signal` when there is one,
 * otherwise a plain one (the signal-bearing texts are only drawn for people
 * who carry that signal).
 */
function pickEntry(
  rng: Rng,
  candidates: readonly BankEntry[],
  options: { signal?: Signal; relation?: Relation },
): BankEntry {
  const { relation } = options;
  const narrow = (list: readonly BankEntry[]) =>
    relation
      ? list.filter(
          (entry) => shares(entry, relation.themes) === relation.shared,
        )
      : list;
  const carrying = options.signal
    ? sayingSignal(candidates, options.signal)
    : [];
  const plain = candidates.filter((entry) => !hasSignal(entry));
  const from = [
    narrow(carrying),
    carrying,
    narrow(plain),
    plain,
    candidates,
  ].find((list) => list.length > 0);
  return rng.pick(from ?? candidates);
}

/** An answer of the form that could say a signal, and the texts it could hold. */
interface Slot {
  question: BankQuestion;
  side: BankSide;
  candidates: readonly BankEntry[];
}

/** The people of a cycle who carry a signal so far: in all and with each signal. */
interface Tally {
  people: number;
  signals: Map<Signal, number>;
}

/** The people who carry each signal so far, in every cycle, by whose answer says it. */
type SideTally = Map<Signal, Record<BankSide, number>>;

/**
 * The option furthest behind its share of what has been given so far, with a
 * little chance so it is not a fixed rotation: a cycle gets each option about
 * as often as its share says, whoever draws it.
 */
function furthestBehind<T>(
  rng: Rng,
  total: number,
  options: readonly { value: T; share: number; given: number }[],
): T {
  return options
    .map(({ value, share, given }) => ({
      value,
      score: share * (total + 1) - given + rng.next(),
    }))
    .reduce((best, next) => (next.score > best.score ? next : best)).value;
}

/**
 * The signal a participant carries and the answer that says it: the signal
 * by `SIGNAL_SHARE` in the cycle, among those some answer of this form has a
 * text for; its side by `OWN_SHARE` in all of them; the answer of that side
 * by `SLOT_WEIGHT`.
 */
function pickCarrier(
  rng: Rng,
  slots: readonly Slot[],
  tally: Tally,
  sides: SideTally,
): { slot: Slot; signal: Signal } | undefined {
  const answers = (signal: Signal) =>
    slots.filter((slot) => sayingSignal(slot.candidates, signal).length > 0);
  const possible = SIGNALS.filter((signal) => answers(signal).length > 0);
  if (possible.length === 0) return undefined;
  const signal = furthestBehind(
    rng,
    tally.people,
    possible.map((value) => ({
      value,
      share: SIGNAL_SHARE[value] / 100,
      given: tally.signals.get(value) ?? 0,
    })),
  );
  const options = answers(signal);
  const given = sides.get(signal) ?? { self: 0, manager: 0 };
  const side = furthestBehind(
    rng,
    given.self + given.manager,
    [...new Set(options.map((slot) => slot.side))].map((value) => ({
      value,
      share: value === "self" ? OWN_SHARE[signal] : 1 - OWN_SHARE[signal],
      given: given[value],
    })),
  );
  const slot = rng.weighted(
    options
      .filter((candidate) => candidate.side === side)
      .map(
        (candidate) =>
          [candidate, SLOT_WEIGHT[candidate.question] ?? 1] as const,
      ),
  );
  return { slot, signal };
}

/** The bank by question, side and language, without the texts that name someone the company does not have. */
function buildPools(
  firstNames: ReadonlySet<string>,
): Map<string, readonly BankEntry[]> {
  const pools = new Map<string, BankEntry[]>();
  for (const entry of TEXT_BANK) {
    if (!namesIn(entry.text).every((name) => firstNames.has(name))) continue;
    const key = `${entry.question}|${entry.side}|${entry.lang}`;
    pools.set(key, [...(pools.get(key) ?? []), entry]);
  }
  return pools;
}

/** A yes or no on its own, in the spellings of the real reports. */
function bareAnswer(rng: Rng, lang: BankLang): string {
  return lang === "en"
    ? rng.weighted([
        ["Yes", 80],
        ["No", 20],
      ] as const)
    : rng.weighted([
        ["Sí", 58],
        ["Si", 14],
        ["No", 24],
        ["Yes", 4],
      ] as const);
}

export function applyBankTexts(
  assessments: readonly FixtureAssessment[],
  employees: readonly FixtureEmployee[],
  seed: number,
): FixtureAssessment[] {
  const rng = createRng((seed ^ STREAM_SALT) >>> 0);
  const pools = buildPools(new Set(employees.map((e) => e.firstName)));
  const carriers = chooseCarriers(rng, assessments);
  const tallies = new Map<number, Tally>();
  const sides: SideTally = new Map();
  // Nobody repeats a text to the letter two cycles in a row.
  const lastText = new Map<string, string>();

  return assessments.map((assessment, index) => {
    const { selfAnswers, managerAnswers } = assessment;
    if (!selfAnswers && !managerAnswers) return assessment;
    const who = assessment.employeeId ?? assessment.outsiderName ?? "";
    const lang: Record<BankSide, BankLang> = {
      self: rng.chance(ENGLISH_SHARE) ? "en" : "es",
      manager: rng.chance(ENGLISH_SHARE) ? "en" : "es",
    };
    const aligned =
      selfAnswers && managerAnswers ? rng.chance(ALIGNED_SHARE) : null;
    const self = selfAnswers && { ...selfAnswers };
    const manager = managerAnswers && { ...managerAnswers };

    /** What can be written in an answer: its pool, without last cycle's text. */
    const candidatesOf = (question: BankQuestion, side: BankSide) => {
      const pool = pools.get(`${question}|${side}|${lang[side]}`) ?? [];
      const last = lastText.get(`${who}|${question}|${side}`);
      const fresh = pool.filter((entry) => entry.text !== last);
      return fresh.length > 0 ? fresh : pool;
    };

    const tally = tallies.get(assessment.cycle) ?? {
      people: 0,
      signals: new Map<Signal, number>(),
    };
    tallies.set(assessment.cycle, tally);
    const slots: Slot[] = [];
    const addSlot = (question: BankQuestion, side: BankSide) =>
      slots.push({ question, side, candidates: candidatesOf(question, side) });
    if (self) {
      addSlot("strengths", "self");
      addSlot("improvement", "self");
      if (self.q2 === "E") addSlot("best_work_other", "self");
    }
    if (manager) {
      addSlot("strengths", "manager");
      addSlot("improvement", "manager");
    }
    const carrier = carriers.has(index)
      ? pickCarrier(rng, slots, tally, sides)
      : undefined;

    const draw = (
      question: BankQuestion,
      side: BankSide,
      relation?: Relation,
    ): BankEntry => {
      const says =
        carrier?.slot.question === question && carrier.slot.side === side
          ? carrier.signal
          : undefined;
      const entry = pickEntry(rng, candidatesOf(question, side), {
        signal: says,
        relation,
      });
      if (says) {
        // Counts what the text says, all of it, so the signals it carries
        // along are made up for in the next people.
        tally.people++;
        for (const signal of SIGNALS.filter((s) =>
          entry.expected.signals.includes(s),
        )) {
          tally.signals.set(signal, (tally.signals.get(signal) ?? 0) + 1);
          const given = sides.get(signal) ?? { self: 0, manager: 0 };
          given[side]++;
          sides.set(signal, given);
        }
      }
      lastText.set(`${who}|${question}|${side}`, entry.text);
      return entry;
    };

    const open = [
      ["strengths", "q3"],
      ["improvement", "q4"],
    ] as const;
    const mine = new Map<BankQuestion, BankEntry>();
    if (self) {
      for (const [question, field] of open) {
        const entry = draw(question, "self");
        mine.set(question, entry);
        self[field] = entry.text;
      }
    }
    if (manager) {
      // What the employee wrote about, in both answers.
      const themesOfSelf = [...mine.values()].flatMap((e) => e.expected.themes);
      for (const [question, field] of open) {
        const own = mine.get(question)?.expected.themes ?? [];
        const relation: Relation | undefined =
          aligned === null
            ? undefined
            : aligned
              ? { themes: own.length > 0 ? own : themesOfSelf, shared: true }
              : { themes: themesOfSelf, shared: false };
        manager[field] = draw(question, "manager", relation).text;
      }
    }

    if (self) {
      for (const [question, field] of [
        ["social_impact", "socialImpact"],
        ["environmental_impact", "environmentalImpact"],
      ] as const) {
        self[field] = rng.chance(BARE_SHARE)
          ? bareAnswer(rng, lang.self)
          : draw(question, "self").text;
      }
      if (self.q2 === "E") {
        self.bestWorkOther = draw("best_work_other", "self").text;
      }
    }

    return { ...assessment, selfAnswers: self, managerAnswers: manager };
  });
}
