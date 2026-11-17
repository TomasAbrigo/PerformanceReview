import type { LocalizedText, ScaleSnapshot } from "@/db/schema";
import type { QuestionMapping } from "@/modules/lake/profiles";
import type { QuestionKind } from "@/modules/templates/constants";

/**
 * The question columns of Bamboo's Employee Performance report, as question
 * revisions of an imported cycle (docs/research/02 and 07). Headers embed the
 * question text: "Employee Q1: How well does <company> recognize my value?",
 * "Manager Custom Q2: <text>". Answers to the standard Q1/Q2 are exported as
 * letters (A = best), Q3/Q4 are free text and custom questions are rated 1-5.
 */

type Choice = { value: string; label: LocalizedText };

const choices = (labels: [string, string][]): Choice[] =>
  labels.map(([en, es], i) => ({
    value: String.fromCharCode(65 + i),
    label: { es, en },
  }));

const STANDARD = {
  self: {
    q1: choices([
      ["I feel highly valued", "Me siento muy valorado"],
      ["I sometimes feel valued", "A veces me siento valorado"],
      ["I am not sure others value me", "No estoy seguro de que me valoren"],
      ["I do not feel valued", "No me siento valorado"],
    ]),
    q2: choices([
      [
        "Company direction better defined",
        "Una dirección de la empresa más definida",
      ],
      ["Coworkers more committed", "Compañeros más comprometidos"],
      ["Work that fits my strengths", "Un trabajo acorde a mis fortalezas"],
      ["Nothing, I have all I need", "Nada, tengo todo lo que necesito"],
      ["Other", "Otro"],
    ]),
  },
  manager: {
    q1: choices([
      ["Do everything to keep them", "Haría todo para retenerlo"],
      ["Try to convince them to stay", "Intentaría convencerlo de quedarse"],
      ["Need to think about it", "Tendría que pensarlo"],
      ["Wish them well", "Le desearía lo mejor"],
      ["Be relieved", "Me sentiría aliviado"],
    ]),
    q2: choices([
      ["Highly engaged", "Muy comprometido"],
      ["Engaged", "Comprometido"],
      ["Somewhat engaged", "Algo comprometido"],
      ["Not very engaged", "Poco comprometido"],
      ["No engagement, checked out", "Sin compromiso, desconectado"],
    ]),
  },
} as const;

/** Bamboo's default rating scale: 1 Strongly Disagree .. 5 Strongly Agree. */
export const IMPORTED_SCALE: ScaleSnapshot = {
  options: (
    [
      ["Strongly disagree", "Muy en desacuerdo"],
      ["Disagree", "En desacuerdo"],
      ["Neutral", "Neutral"],
      ["Agree", "De acuerdo"],
      ["Strongly agree", "Muy de acuerdo"],
    ] as const
  ).map(([en, es], i) => ({
    value: i + 1,
    label: { es, en },
    normalized: i / 4,
  })),
};

const SECTIONS: Record<Side, LocalizedText> = {
  self: { es: "Autoevaluación", en: "Self assessment" },
  manager: { es: "Evaluación del manager", en: "Manager assessment" },
};

export type Side = "self" | "manager";

/** One question column of the report, as the revision it becomes. */
export type QuestionColumn = {
  /** Stable per cycle: "self:q1", "manager:custom:<n>:<lowercased text>". */
  key: string;
  /** The exact header (the key into the row). */
  header: string;
  relationship: Side;
  kind: QuestionKind;
  prompt: LocalizedText;
  sectionTitle: LocalizedText;
  visibleToReviewee: boolean;
  choices: Choice[] | null;
  scale: ScaleSnapshot | null;
  sort: number;
  /** What the question measures (configured mapping only; see #57). */
  dimension?: string;
  role?: string;
};

const PATTERN = /^(Employee|Manager) (Custom )?Q(\d+):\s*(.+)$/;

type Found = Omit<QuestionColumn, "sort"> & { order: number };

/** A header Bamboo's pattern recognises, as its question column. */
function fromPattern(header: string): Found | null {
  const match = PATTERN.exec(header.trim());
  if (!match) return null;
  const [, who, custom, n, text] = match;
  const side: Side = who === "Employee" ? "self" : "manager";
  const number = Number(n);
  const base = {
    header,
    relationship: side,
    prompt: { es: text, en: text },
    sectionTitle: SECTIONS[side],
  };
  if (custom) {
    return {
      ...base,
      key: `${side}:custom:${number}:${text.toLowerCase()}`,
      kind: "rating",
      visibleToReviewee: true,
      choices: null,
      scale: IMPORTED_SCALE,
      order: (side === "self" ? 0 : 1000) + 100 + number,
    };
  }
  if (number > 4) return null;
  const options =
    number <= 2
      ? STANDARD[side][`q${number}` as "q1" | "q2"].map((c) => ({ ...c }))
      : null;
  return {
    ...base,
    key: `${side}:q${number}`,
    kind: options ? "single_choice" : "text",
    // Bamboo: the employee never sees the manager's Q1/Q2.
    visibleToReviewee: !(side === "manager" && number <= 2),
    choices: options,
    scale: null,
    order: (side === "self" ? 0 : 1000) + number,
  };
}

/** The letters of a configured letter choice (Bamboo's own for Q1/Q2). */
function letterChoices(entry: QuestionMapping): Choice[] {
  if (entry.options?.length) {
    return choices(entry.options.map((label) => [label, label]));
  }
  const standard = /^(self|manager):(q[12])$/.exec(entry.key);
  if (standard) {
    return STANDARD[standard[1] as Side][standard[2] as "q1" | "q2"].map(
      (c) => ({ ...c }),
    );
  }
  return choices(["A", "B", "C", "D", "E"].map((l) => [l, l]));
}

/** A configured column; ordered like its pattern twin when it has one. */
function fromMapping(entry: QuestionMapping, index: number): Found {
  const twin = fromPattern(entry.column);
  const text = twin?.prompt.es ?? entry.column;
  const kind: QuestionKind =
    entry.kind === "likert"
      ? "rating"
      : entry.kind === "letter_choice"
        ? "single_choice"
        : "text";
  return {
    key: entry.key,
    header: entry.column,
    relationship: entry.side,
    kind,
    prompt: { es: text, en: text },
    sectionTitle: SECTIONS[entry.side],
    // As in Bamboo: the employee never sees the manager's letter questions.
    visibleToReviewee: !(
      entry.side === "manager" && entry.kind === "letter_choice"
    ),
    choices: kind === "single_choice" ? letterChoices(entry) : null,
    scale: kind === "rating" ? IMPORTED_SCALE : null,
    order: twin?.order ?? (entry.side === "self" ? 0 : 1000) + 500 + index,
    ...(entry.dimension ? { dimension: entry.dimension } : {}),
    ...(entry.role ? { role: entry.role } : {}),
  };
}

/**
 * The question columns among a report's headers: self questions first, then
 * the manager's; standard ones before custom ones. Columns in `mapping` (the
 * source profile's `questions`) are taken as configured; the others are
 * detected by Bamboo's header pattern. Other columns are ignored.
 */
export function detectQuestionColumns(
  headers: string[],
  mapping: readonly QuestionMapping[] = [],
): QuestionColumn[] {
  const configured = new Map(mapping.map((m, i) => [m.column, { m, i }]));
  const found: Found[] = [];
  for (const header of headers) {
    const entry = configured.get(header);
    const column = entry ? fromMapping(entry.m, entry.i) : fromPattern(header);
    if (column) found.push(column);
  }
  // A configured key wins over a detected column that happens to share it.
  const keys = new Set(
    found.filter((f) => configured.has(f.header)).map((f) => f.key),
  );
  return found
    .filter((f) => configured.has(f.header) || !keys.has(f.key))
    .sort((a, b) => a.order - b.order)
    .map((entry, sort) => {
      const column: QuestionColumn & { order?: number } = { ...entry, sort };
      delete column.order;
      return column;
    });
}

export type AnswerColumns = {
  optionValue: number | null;
  optionLabel: string | null;
  normalized: number | null;
  textValue: string | null;
};

/**
 * The answer columns for one cell, as review-core stores native answers
 * (single choice: the letter; rating: value, label and normalized value).
 * null for an empty cell; `invalid` for a value the question cannot take.
 */
export function answerColumns(
  column: Pick<QuestionColumn, "kind" | "choices" | "scale">,
  cell: unknown,
): AnswerColumns | { invalid: true } | null {
  if (cell === null || cell === undefined) return null;
  const text = String(cell).trim();
  if (text === "") return null;
  const none = {
    optionValue: null,
    optionLabel: null,
    normalized: null,
    textValue: null,
  };
  if (column.kind === "single_choice") {
    const choice = column.choices?.find((c) => c.value === text.toUpperCase());
    return choice ? { ...none, optionLabel: choice.value } : { invalid: true };
  }
  if (column.kind === "rating") {
    const option = column.scale?.options.find((o) => o.value === Number(text));
    if (!option) return { invalid: true };
    return {
      ...none,
      optionValue: option.value,
      optionLabel: option.label.es,
      normalized: option.normalized,
    };
  }
  return { ...none, textValue: String(cell) };
}
