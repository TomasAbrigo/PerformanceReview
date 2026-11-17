/**
 * Likert mapping (pure): how a historical answer to a closed manager question
 * (retention, engagement) becomes a 1-5 value. Bamboo exports those answers as
 * letters (A = best); the table of equivalences is per role and per option
 * count (A-E and A-D). See docs/likert-mapping.md.
 */
import type { QuestionRole } from "@/modules/templates/constants";

export type LikertRole = Extract<QuestionRole, "retention" | "engagement">;
export const likertRoles = [
  "retention",
  "engagement",
] as const satisfies readonly LikertRole[];

export const isLikertRole = (role: unknown): role is LikertRole =>
  (likertRoles as readonly unknown[]).includes(role);

/** The scale every Likert question lands on. */
export const LIKERT_MIN = 1;
export const LIKERT_MAX = 5;

const FIVE = { A: 5, B: 4, C: 3, D: 2, E: 1 };
const FOUR = { A: 5, B: 4, C: 2, D: 1 };

/** Default equivalences: role -> option count -> letter -> value. */
export const defaultLikertMappings: Record<
  LikertRole,
  Record<number, Record<string, number>>
> = {
  retention: { 5: { ...FIVE }, 4: { ...FOUR } },
  engagement: { 5: { ...FIVE }, 4: { ...FOUR } },
};

type Text = { es: string; en: string };
/** One option, best first: Bamboo's wording (research/07) and our scale's. */
type LikertOption = { bamboo: Text; scale: Text };

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
    },
    {
      bamboo: { en: "Need to think about it", es: "Tendría que pensarlo" },
      scale: { en: "Need to think about it", es: "Tendría que pensarlo" },
    },
    {
      bamboo: { en: "Wish them well", es: "Le desearía lo mejor" },
      scale: { en: "Wish them well", es: "Le desearía lo mejor" },
    },
    {
      bamboo: { en: "Be relieved", es: "Me sentiría aliviado" },
      scale: { en: "I'd be relieved", es: "Me aliviaría que se fuera" },
    },
  ],
  engagement: [
    {
      bamboo: { en: "Highly engaged", es: "Muy comprometido" },
      scale: { en: "Highly engaged", es: "Muy comprometido" },
    },
    {
      bamboo: { en: "Engaged", es: "Comprometido" },
      scale: { en: "Engaged", es: "Comprometido" },
    },
    {
      bamboo: { en: "Somewhat engaged", es: "Algo comprometido" },
      scale: { en: "Somewhat engaged", es: "Algo comprometido" },
    },
    {
      bamboo: { en: "Not very engaged", es: "Poco comprometido" },
      scale: { en: "Not very engaged", es: "Poco comprometido" },
    },
    {
      bamboo: {
        en: "No engagement, checked out",
        es: "Sin compromiso, desconectado",
      },
      scale: { en: "No engagement", es: "Sin compromiso" },
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
const LABEL_VALUES: Record<LikertRole, Map<string, number>> = {
  retention: labelMap("retention"),
  engagement: labelMap("engagement"),
};

function labelMap(role: LikertRole): Map<string, number> {
  const map = new Map<string, number>();
  LIKERT_OPTIONS[role].forEach((option, i) => {
    for (const text of [option.bamboo, option.scale]) {
      map.set(foldText(text.es), LIKERT_MAX - i);
      map.set(foldText(text.en), LIKERT_MAX - i);
    }
  });
  return map;
}

const result = (value: number | undefined): LikertResult =>
  value !== undefined &&
  Number.isInteger(value) &&
  value >= LIKERT_MIN &&
  value <= LIKERT_MAX
    ? { value, normalized: (value - LIKERT_MIN) / (LIKERT_MAX - LIKERT_MIN) }
    : { unmapped: true };

/** The 1-5 value of one raw answer, or `unmapped`. */
export function mapLikert(
  input: LikertInput,
  overrides: LikertOverrides = {},
): LikertResult {
  const text = foldText(String(input.raw ?? ""));
  if (text === "") return { unmapped: true };
  const count = input.optionCount ?? input.options?.length ?? 5;
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
  return result(LABEL_VALUES[input.role].get(text));
}
