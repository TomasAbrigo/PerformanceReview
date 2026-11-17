/**
 * Likert mapping (pure): how a historical answer to a closed question becomes
 * a value on its role's scale: retention and engagement 1-5 (manager side),
 * valued 1-4 (self side, "How well does [Company] recognize my value?").
 * Bamboo's legacy report exports those answers as letters (A = best); its
 * raw report as English labels, matched by exact label or by keywords (so
 * the employee's name inside a label does not matter). The table of letter
 * equivalences is per role and per option count. See docs/likert-mapping.md.
 */
import type { QuestionRole } from "@/modules/templates/constants";

export type LikertRole = Extract<
  QuestionRole,
  "retention" | "engagement" | "valued"
>;
export const likertRoles = [
  "retention",
  "engagement",
  "valued",
] as const satisfies readonly LikertRole[];

export const isLikertRole = (role: unknown): role is LikertRole =>
  (likertRoles as readonly unknown[]).includes(role);

/** The scale Likert questions land on: 1..max of their role. */
export const LIKERT_MIN = 1;
export const LIKERT_MAX = 5;
export const LIKERT_ROLE_MAX: Record<LikertRole, number> = {
  retention: 5,
  engagement: 5,
  valued: 4,
};

const FIVE = { A: 5, B: 4, C: 3, D: 2, E: 1 };
const FOUR = { A: 5, B: 4, C: 2, D: 1 };

/** Default equivalences: role -> option count -> letter -> value. */
export const defaultLikertMappings: Record<
  LikertRole,
  Record<number, Record<string, number>>
> = {
  retention: { 5: { ...FIVE }, 4: { ...FOUR } },
  engagement: { 5: { ...FIVE }, 4: { ...FOUR } },
  valued: { 4: { A: 4, B: 3, C: 2, D: 1 } },
};

type Text = { es: string; en: string };
/**
 * One option, best first: Bamboo's legacy wording (research/07), our scale's,
 * the labels of Bamboo's raw report (`labels`, exact match) and `keywords`
 * (folded text, tried in order over every option of the role after the exact
 * labels) for label variants such as the employee's name inside one.
 */
type LikertOption = {
  bamboo: Text;
  scale: Text;
  labels?: string[];
  keywords?: RegExp[];
};

/**
 * The single source of the option labels: the importer's choices (Bamboo
 * wording), the system scales (`retention_1_5`, `engagement_1_5`) and the
 * label matching of mapLikert all come from here. Index 0 = 5.
 */
export const LIKERT_OPTIONS: Record<LikertRole, LikertOption[]> = {
  retention: [
    {
      bamboo: {
        en: "Do everything to keep them",
        es: "Haría todo para retenerlo",
      },
      scale: {
        en: "Do everything to keep them",
        es: "Haría todo por retenerlo",
      },
      labels: ["I would do everything I can to keep them."],
      keywords: [/\beverything\b/],
    },
    {
      bamboo: {
        en: "Try to convince them to stay",
        es: "Intentaría convencerlo de quedarse",
      },
      scale: {
        en: "Try to convince them to stay",
        es: "Intentaría convencerlo de quedarse",
      },
      labels: ["I would try to convince them to stay."],
      keywords: [/\bconvince\b/, /difficult to replace/],
    },
    {
      bamboo: { en: "Need to think about it", es: "Tendría que pensarlo" },
      scale: { en: "Need to think about it", es: "Tendría que pensarlo" },
      labels: ["I would think about it, but I would be okay either way."],
      keywords: [/\bthink about\b/, /either way/],
    },
    {
      bamboo: { en: "Wish them well", es: "Le desearía lo mejor" },
      scale: { en: "Wish them well", es: "Le desearía lo mejor" },
      labels: ["I would wish them well."],
      keywords: [/wish them well/, /let them go/],
    },
    {
      bamboo: { en: "Be relieved", es: "Me sentiría aliviado" },
      scale: { en: "I'd be relieved", es: "Me aliviaría que se fuera" },
      labels: ["I would be relieved."],
      keywords: [/\brelieved\b/],
    },
  ],
  engagement: [
    {
      bamboo: { en: "Highly engaged", es: "Muy comprometido" },
      scale: { en: "Highly engaged", es: "Muy comprometido" },
      labels: ["Highly engaged and a great attitude."],
      keywords: [/^highly engaged/],
    },
    {
      bamboo: { en: "Engaged", es: "Comprometido" },
      scale: { en: "Engaged", es: "Comprometido" },
      labels: ["Engaged and a good attitude."],
      keywords: [/^engaged\b/],
    },
    {
      bamboo: { en: "Somewhat engaged", es: "Algo comprometido" },
      scale: { en: "Somewhat engaged", es: "Algo comprometido" },
      labels: ["Medium engagement and an okay attitude."],
      keywords: [/^medium engagement/, /^somewhat engaged/],
    },
    {
      bamboo: { en: "Not very engaged", es: "Poco comprometido" },
      scale: { en: "Not very engaged", es: "Poco comprometido" },
      labels: ["Low engagement and a poor attitude."],
      keywords: [/^low engagement/, /^not very engaged/],
    },
    {
      bamboo: {
        en: "No engagement, checked out",
        es: "Sin compromiso, desconectado",
      },
      scale: { en: "No engagement", es: "Sin compromiso" },
      labels: ["Not engaged at all and a negative attitude."],
      keywords: [/^not engaged/, /^no engagement/, /disengaged/],
    },
  ],
  // Self side, 1-4: "How well does [Company] recognize my value?".
  valued: [
    {
      bamboo: { en: "I feel highly valued", es: "Me siento muy valorado" },
      scale: { en: "Highly valued", es: "Muy valorado" },
      labels: ["I feel I am highly valued."],
      keywords: [/highly valued/],
    },
    {
      bamboo: {
        en: "I sometimes feel valued",
        es: "A veces me siento valorado",
      },
      scale: { en: "Sometimes valued", es: "A veces valorado" },
      labels: ["I sometimes feel valued."],
      keywords: [/sometimes/],
    },
    {
      bamboo: {
        en: "I am not sure others value me",
        es: "No estoy seguro de que me valoren",
      },
      scale: { en: "Not sure", es: "No estoy seguro" },
      labels: ["I'm not sure others value me."],
      keywords: [/not sure/],
    },
    {
      bamboo: { en: "I do not feel valued", es: "No me siento valorado" },
      scale: { en: "Not valued", es: "No valorado" },
      labels: ["I don't feel valued."],
      keywords: [/\b(don'?t|do not|not) feel valued/],
    },
  ],
};

/**
 * Overrides per role: key "<option>" (any option count) or
 * "<optionCount>:<option>" (that count only, wins), value 1..5.
 */
export type LikertOverrides = Partial<Record<string, Record<string, number>>>;

export type LikertInput = {
  role: LikertRole;
  /** How many options the source question had (default 5). */
  optionCount?: number;
  /** The source options; their count is used when optionCount is absent. */
  options?: readonly unknown[];
  raw: unknown;
};

export type LikertResult =
  { value: number; normalized: number } | { unmapped: true };

export const foldText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Folded label -> value, per role (built once). */
const LABEL_VALUES = Object.fromEntries(
  likertRoles.map((role) => [role, labelMap(role)]),
) as Record<LikertRole, Map<string, number>>;

function labelMap(role: LikertRole): Map<string, number> {
  const map = new Map<string, number>();
  const max = LIKERT_ROLE_MAX[role];
  LIKERT_OPTIONS[role].forEach((option, i) => {
    for (const text of [option.bamboo, option.scale]) {
      map.set(foldText(text.es), max - i);
      map.set(foldText(text.en), max - i);
    }
    for (const label of option.labels ?? []) map.set(foldText(label), max - i);
  });
  return map;
}

/** Without trailing punctuation: "Engaged." = "Engaged". */
const bare = (s: string) => s.replace(/[\s.!]+$/u, "");

/** The value of a label variant, by the first option whose keyword hits. */
function byKeywords(role: LikertRole, text: string): number | undefined {
  const max = LIKERT_ROLE_MAX[role];
  for (const [i, option] of LIKERT_OPTIONS[role].entries()) {
    if (option.keywords?.some((k) => k.test(text))) return max - i;
  }
  return undefined;
}

const resultFor =
  (role: LikertRole) =>
  (value: number | undefined): LikertResult => {
    const max = LIKERT_ROLE_MAX[role];
    return value !== undefined &&
      Number.isInteger(value) &&
      value >= LIKERT_MIN &&
      value <= max
      ? { value, normalized: (value - LIKERT_MIN) / (max - LIKERT_MIN) }
      : { unmapped: true };
  };

/** The value (1..max of the role) of one raw answer, or `unmapped`. */
export function mapLikert(
  input: LikertInput,
  overrides: LikertOverrides = {},
): LikertResult {
  const text = foldText(String(input.raw ?? ""));
  if (text === "") return { unmapped: true };
  const result = resultFor(input.role);
  const count =
    input.optionCount ??
    input.options?.length ??
    LIKERT_OPTIONS[input.role].length;
  const own = overrides[input.role];
  if (/^[a-z]$/.test(text)) {
    const letter = text.toUpperCase();
    return result(
      own?.[`${count}:${letter}`] ??
        own?.[letter] ??
        defaultLikertMappings[input.role][count]?.[letter],
    );
  }
  if (/^\d+$/.test(text)) {
    // Numbers go through the same overrides; otherwise they are the value
    // itself, within 1..optionCount.
    const n = Number(text);
    const overridden = own?.[`${count}:${text}`] ?? own?.[text];
    if (overridden !== undefined) return result(overridden);
    return n >= LIKERT_MIN && n <= count ? result(n) : { unmapped: true };
  }
  const labels = LABEL_VALUES[input.role];
  return result(
    labels.get(text) ??
      labels.get(bare(text)) ??
      byKeywords(input.role, bare(text)),
  );
}
