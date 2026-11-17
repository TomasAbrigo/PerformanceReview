/**
 * Likert mapping (pure): how a historical answer to a closed manager question
 * (retention, engagement) becomes a 1-5 value. Bamboo exports those answers as
 * letters (A = best); the table of equivalences is per role and per option
 * count (A-E and A-D). See docs/likert-mapping.md.
 */

export const likertRoles = ["retention", "engagement"] as const;
export type LikertRole = (typeof likertRoles)[number];

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

/**
 * Bamboo's option labels (research/07) and our scale labels, best first
 * (index 0 = 5). Matched case- and accent-insensitively.
 */
export const LIKERT_LABELS: Record<LikertRole, string[][]> = {
  retention: [
    [
      "Do everything to keep them",
      "Do everything I could to keep them",
      "Haría todo para retenerlo",
      "Haría todo por retenerlo",
    ],
    ["Try to convince them to stay", "Intentaría convencerlo de quedarse"],
    ["Need to think about it", "Tendría que pensarlo"],
    ["Wish them well", "Le desearía lo mejor"],
    [
      "Be relieved",
      "I'd be relieved",
      "Me sentiría aliviado",
      "Me aliviaría que se fuera",
    ],
  ],
  engagement: [
    ["Highly engaged", "Muy comprometido"],
    ["Engaged", "Comprometido"],
    ["Somewhat engaged", "Algo comprometido"],
    ["Not very engaged", "Poco comprometido"],
    [
      "No engagement, checked out",
      "No engagement",
      "Sin compromiso, desconectado",
      "Sin compromiso",
    ],
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
  if (/^[a-z]$/.test(text)) {
    const letter = text.toUpperCase();
    const own = overrides[input.role];
    return result(
      own?.[`${count}:${letter}`] ??
        own?.[letter] ??
        defaultLikertMappings[input.role][count]?.[letter],
    );
  }
  if (/^\d+$/.test(text)) return result(Number(text));
  const index = LIKERT_LABELS[input.role].findIndex((labels) =>
    labels.some((l) => foldText(l) === text),
  );
  return index === -1 ? { unmapped: true } : result(LIKERT_MAX - index);
}
