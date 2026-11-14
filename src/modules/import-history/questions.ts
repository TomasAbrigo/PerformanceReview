import type { LocalizedText, ScaleSnapshot } from "@/db/schema";
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
  /** Stable per cycle: "self:q1", "manager:custom:<lowercased text>". */
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
};

const PATTERN = /^(Employee|Manager) (Custom )?Q(\d+):\s*(.+)$/;

/**
 * The question columns among a report's headers: self questions first, then
 * the manager's; standard ones before custom ones. Other columns are ignored.
 */
export function detectQuestionColumns(headers: string[]): QuestionColumn[] {
  const found: (Omit<QuestionColumn, "sort"> & { order: number })[] = [];
  for (const header of headers) {
    const match = PATTERN.exec(header.trim());
    if (!match) continue;
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
      found.push({
        ...base,
        key: `${side}:custom:${text.toLowerCase()}`,
        kind: "rating",
        visibleToReviewee: true,
        choices: null,
        scale: IMPORTED_SCALE,
        order: (side === "self" ? 0 : 1000) + 100 + number,
      });
      continue;
    }
    if (number > 4) continue;
    const options =
      number <= 2
        ? STANDARD[side][`q${number}` as "q1" | "q2"].map((c) => ({ ...c }))
        : null;
    found.push({
      ...base,
      key: `${side}:q${number}`,
      kind: options ? "single_choice" : "text",
      // Bamboo: the employee never sees the manager's Q1/Q2.
      visibleToReviewee: !(side === "manager" && number <= 2),
      choices: options,
      scale: null,
      order: (side === "self" ? 0 : 1000) + number,
    });
  }
  return found
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
