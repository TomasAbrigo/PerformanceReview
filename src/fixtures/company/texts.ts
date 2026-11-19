import { FIRST_NAMES } from "./catalog";
import { createRng, type Rng } from "./rng";
import {
  TEXT_BANK,
  type BankEntry,
  type BankLang,
  type BankQuestion,
  type BankSide,
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
 * - The signals of the bank (overload, intent to leave...) turn up more when
 *   the participant's closed answers are low: "valued" of the employee,
 *   retention and engagement of the manager.
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

/** Odds that an answer is one of the bank's signal-bearing texts. */
function signalChance(
  question: "strengths" | "improvement",
  low: number,
): number {
  return question === "strengths" ? 0.04 + 0.22 * low : 0.13 + 0.65 * low;
}

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

function pickEntry(
  rng: Rng,
  pool: readonly BankEntry[],
  options: { chance: number; relation?: Relation; avoid?: string },
): BankEntry {
  const fresh = pool.filter((entry) => entry.text !== options.avoid);
  const candidates = fresh.length > 0 ? fresh : pool;
  const flagged = candidates.filter(hasSignal);
  const plain = candidates.filter((entry) => !hasSignal(entry));
  const wantFlagged = rng.chance(options.chance);
  const primary = wantFlagged ? flagged : plain;
  const secondary = wantFlagged ? plain : flagged;
  const { relation } = options;
  const narrow = (list: readonly BankEntry[]) =>
    relation
      ? list.filter(
          (entry) => shares(entry, relation.themes) === relation.shared,
        )
      : list;
  const from = [narrow(primary), narrow(secondary), primary, secondary].find(
    (list) => list.length > 0,
  );
  return rng.pick(from ?? candidates);
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
  // Nobody repeats a text to the letter two cycles in a row.
  const lastText = new Map<string, string>();

  return assessments.map((assessment) => {
    const { selfAnswers, managerAnswers } = assessment;
    if (!selfAnswers && !managerAnswers) return assessment;
    const who = assessment.employeeId ?? assessment.outsiderName ?? "";
    const low = lowness(selfAnswers, managerAnswers);
    const lang: Record<BankSide, BankLang> = {
      self: rng.chance(ENGLISH_SHARE) ? "en" : "es",
      manager: rng.chance(ENGLISH_SHARE) ? "en" : "es",
    };
    const aligned =
      selfAnswers && managerAnswers ? rng.chance(ALIGNED_SHARE) : null;
    const self = selfAnswers && { ...selfAnswers };
    const manager = managerAnswers && { ...managerAnswers };

    const draw = (
      question: BankQuestion,
      side: BankSide,
      chance: number,
      relation?: Relation,
    ): BankEntry => {
      const key = `${who}|${question}|${side}`;
      const pool = pools.get(`${question}|${side}|${lang[side]}`) ?? [];
      const entry = pickEntry(rng, pool, {
        chance,
        relation,
        avoid: lastText.get(key),
      });
      lastText.set(key, entry.text);
      return entry;
    };

    const open = [
      ["strengths", "q3"],
      ["improvement", "q4"],
    ] as const;
    const mine = new Map<BankQuestion, BankEntry>();
    if (self) {
      for (const [question, field] of open) {
        const entry = draw(question, "self", signalChance(question, low));
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
        manager[field] = draw(
          question,
          "manager",
          signalChance(question, low),
          relation,
        ).text;
      }
    }

    if (self) {
      for (const [question, field] of [
        ["social_impact", "socialImpact"],
        ["environmental_impact", "environmentalImpact"],
      ] as const) {
        self[field] = rng.chance(BARE_SHARE)
          ? bareAnswer(rng, lang.self)
          : draw(question, "self", 0).text;
      }
      if (self.q2 === "E") {
        self.bestWorkOther = draw(
          "best_work_other",
          "self",
          signalChance("improvement", low),
        ).text;
      }
    }

    return { ...assessment, selfAnswers: self, managerAnswers: manager };
  });
}
