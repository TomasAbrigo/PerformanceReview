import type { LocalizedText, ScaleSnapshot } from "@/db/schema";
import {
  foldText,
  isLikertRole,
  LIKERT_OPTIONS,
  type LikertOverrides,
  type LikertRole,
  mapLikert,
  storedLikertLabel,
} from "@/modules/likert";
import type {
  CustomQuestionMapping,
  QuestionMapping,
} from "@/modules/lake/profiles";
import type {
  QuestionDimension,
  QuestionKind,
  QuestionRole,
  RevisionDimension,
} from "@/modules/templates/constants";

/**
 * The question columns of Bamboo's Employee Performance report, as question
 * revisions of an imported cycle (docs/research/02 and 07). Headers embed the
 * question text: "Employee Q1: How well does <company> recognize my value?",
 * "Manager Custom Q2: <text>". Answers to the standard Q1/Q2 are exported as
 * letters (A = best), Q3/Q4 are free text and custom questions are rated 1-5.
 *
 * Roles and dimensions (issue #57): manager Q1 is `retention` and Q2
 * `engagement` (their letters become 1-5 through the Likert mapping); Q3 is
 * the `strengths` dimension, Q4 `improvement`, Custom Q<n> `custom_<n>`.
 */

type Choice = { value: string; label: LocalizedText };

const choices = (labels: [string, string][]): Choice[] =>
  labels.map(([en, es], i) => ({
    value: String.fromCharCode(65 + i),
    label: { es, en },
  }));

/** Bamboo's manager Q1/Q2 options, A = best (one source: the likert module). */
const likertChoices = (role: LikertRole): Choice[] =>
  LIKERT_OPTIONS[role].map((o, i) => ({
    value: String.fromCharCode(65 + i),
    label: { es: o.bamboo.es, en: o.bamboo.en },
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
    q1: likertChoices("retention"),
    q2: likertChoices("engagement"),
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
  /** retention / engagement for the manager's Q1 / Q2; null otherwise. */
  role: QuestionRole | null;
  dimension: RevisionDimension | null;
  sort: number;
};

const CUSTOM_DIMENSIONS: Record<number, QuestionDimension> = {
  1: "custom_1",
  2: "custom_2",
  3: "custom_3",
};
const STANDARD_DIMENSIONS: Record<number, QuestionDimension> = {
  3: "strengths",
  4: "improvement",
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
      role: null,
      dimension: CUSTOM_DIMENSIONS[number] ?? null,
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
    role:
      side === "manager" && number === 1
        ? "retention"
        : side === "manager" && number === 2
          ? "engagement"
          : null,
    dimension: STANDARD_DIMENSIONS[number] ?? null,
    order: (side === "self" ? 0 : 1000) + number,
  };
}

/** FNV-1a of a text, 8 hex digits (stable, no crypto: runs in the browser too). */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** "The company direction..." -> "the_company_direction" (a stable code). */
export const slugOf = (text: string, max = 40) =>
  foldText(text)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max)
    .replace(/_+$/, "");

/** The labels of a configured label choice, each with a stable code. */
function labelChoices(entry: QuestionMapping): Choice[] {
  if (isLikertRole(entry.role)) return likertChoices(entry.role);
  return (entry.options ?? []).map((label) => ({
    value: slugOf(label),
    label: { es: label, en: label },
  }));
}

/** The letters of a configured letter choice (Bamboo's own for Q1/Q2). */
function letterChoices(entry: QuestionMapping): Choice[] {
  if (isLikertRole(entry.role)) return likertChoices(entry.role);
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
      : entry.kind === "letter_choice" || entry.kind === "label_choice"
        ? "single_choice"
        : "text";
  const prompt = twin ? text : promptOf(entry.column);
  return {
    key: entry.key,
    header: entry.column,
    relationship: entry.side,
    kind,
    prompt: { es: prompt, en: prompt },
    sectionTitle: SECTIONS[entry.side],
    // As in Bamboo: the employee never sees the manager's closed questions.
    visibleToReviewee: !(
      entry.side === "manager" &&
      (entry.kind === "letter_choice" || entry.kind === "label_choice")
    ),
    choices:
      entry.kind === "label_choice"
        ? labelChoices(entry)
        : kind === "single_choice"
          ? letterChoices(entry)
          : null,
    scale: kind === "rating" ? IMPORTED_SCALE : null,
    // The configured role/dimension win; else what the pattern twin implies.
    role: entry.role ?? twin?.role ?? null,
    dimension: entry.dimension ?? twin?.dimension ?? null,
    order: twin?.order ?? (entry.side === "self" ? 0 : 1000) + 500 + index,
  };
}

/** "Employee - What do I do well?" -> "What do I do well?". */
const promptOf = (header: string) =>
  header.replace(/^(Employee|Manager)\s+-\s+/, "");

/**
 * The custom questions of one row of Bamboo's raw report: each pair whose
 * question cell has text is a text question keyed by its side, number and
 * text (`<side>:custom:<n>:<slug>`), dimension `custom_<slug>`. The answer
 * column is the header the answer is read from.
 */
export function customQuestionColumns(
  pairs: readonly CustomQuestionMapping[],
  row: Record<string, unknown>,
): QuestionColumn[] {
  const columns: QuestionColumn[] = [];
  for (const pair of pairs) {
    const cell = row[pair.questionColumn];
    const text = cell === null || cell === undefined ? "" : String(cell).trim();
    if (!text) continue;
    // Slug for reading, hash of the whole text so long texts never collide.
    const slug = `${slugOf(text) || `q${pair.n}`}_${shortHash(foldText(text))}`;
    columns.push({
      key: `${pair.side}:custom:${pair.n}:${slug}`,
      header: pair.answerColumn,
      relationship: pair.side,
      kind: "text",
      prompt: { es: text, en: text },
      sectionTitle: SECTIONS[pair.side],
      visibleToReviewee: true,
      choices: null,
      scale: null,
      role: null,
      dimension: `custom_${slug}`,
      sort: (pair.side === "self" ? 0 : 1000) + 100 + pair.n,
    });
  }
  return columns;
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
 * Retention and engagement keep the option as label and get the 1-5 value
 * from the Likert mapping (`overrides`: the likert_mapping table);
 * `unmapped` when the option has no equivalence (kept, not rejected).
 */
export function answerColumns(
  column: Pick<QuestionColumn, "kind" | "choices" | "scale"> & {
    role?: QuestionRole | null;
  },
  cell: unknown,
  overrides: LikertOverrides = {},
): AnswerColumns | { invalid: true } | { unmapped: true; raw: string } | null {
  if (cell === null || cell === undefined) return null;
  const text = String(cell).trim();
  if (text === "") return null;
  const none = {
    optionValue: null,
    optionLabel: null,
    normalized: null,
    textValue: null,
  };
  if (isLikertRole(column.role)) {
    const mapped = mapLikert(
      {
        role: column.role,
        optionCount: column.choices?.length ?? column.scale?.options.length,
        raw: text,
      },
      overrides,
    );
    if ("unmapped" in mapped) return { unmapped: true, raw: text };
    return {
      ...none,
      // Never Bamboo's text as it came: it can name the reviewee (#130).
      optionLabel: storedLikertLabel(column.role, text, mapped.value),
      optionValue: mapped.value,
      normalized: mapped.normalized,
    };
  }
  if (column.kind === "single_choice") {
    const choice = column.choices?.find((c) => c.value === text.toUpperCase());
    if (choice) return { ...none, optionLabel: choice.value };
    const labelled = matchLabel(column.choices ?? [], text);
    return labelled ? { ...none, ...labelled } : { invalid: true };
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

/** Folded, without trailing punctuation. */
const foldBare = (s: string) => foldText(s).replace(/[\s.!:]+$/u, "");

/**
 * A label choice (Bamboo's raw report): the option whose label the cell is
 * or starts with. "Other" takes the text after it ("Other: ...",
 * "Other Comentario: ...") as the answer's text.
 */
function matchLabel(
  choices: readonly Choice[],
  cell: string,
): { optionLabel: string; textValue: string | null } | null {
  const text = foldBare(cell);
  for (const choice of choices) {
    const label = foldBare(choice.label.en);
    if (label === "other" || !label) continue;
    if (text === label || text.startsWith(label)) {
      return { optionLabel: choice.value, textValue: null };
    }
  }
  const other = choices.find((c) => foldBare(c.label.en) === "other");
  if (other && /^other\b/.test(text)) {
    const rest = cell
      .trim()
      .replace(/^other\b\s*(comentario|comment)?\s*[:\-–]?\s*/iu, "")
      .trim();
    return { optionLabel: other.value, textValue: rest || null };
  }
  return null;
}
