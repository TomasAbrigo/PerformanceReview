import type { DbOrTx } from "@/db/client";
import type { LocalizedText } from "@/db/schema/rating-scales";
import type { Locale } from "@/i18n/routing";
import type { ActorContext } from "@/modules/actor/types";
import {
  sentiments,
  signals,
  type Sentiment,
  type Signal,
} from "@/modules/qualitative-analysis/constants";
import {
  bestWorkOptions,
  managerFeedbackByGroup,
  signalsByGroup,
  signalSummary,
  substanceByQuestion,
  toneByQuestion,
  valuedDistribution,
  yesNoByGroup,
  yesNoRates,
} from "@/modules/qualitative-analysis/reading";
import type {
  Side,
  ValuedDistribution,
} from "@/modules/qualitative-analysis/reading-types";
import type {
  QualitativeFilters,
  QualitativeGroupBy,
} from "@/modules/qualitative-analysis/types";

/**
 * The rows of the open-text reading CSVs (#129). Each one is the same reader
 * (`reading.ts`) the screen calls, with the same filters, so a file says the
 * numbers of the screen it is downloaded from; nothing here counts anything
 * itself. The unit is the PERSON (distinct reviewees, each once per question
 * and side), self and manager never share a row, and a file never carries
 * text, quotes or names.
 */

/** A share of a base with one decimal (53.8), null without a base. */
export const pctOf = (n: number, base: number): number | null =>
  base > 0 ? Math.round((n / base) * 1000) / 10 : null;

const sideRank = (side: Side) => (side === "self" ? 0 : 1);

// ------------------------------------------------- per question and side

export type QuestionSideRow = {
  dimension: string;
  side: Side;
  /** People with a read answer: the base of the signals and the tone. */
  people: number;
  /** People whose answer has a substance: the base of the substance shares. */
  substancePeople: number;
  none: number;
  generic: number;
  specific: number;
  /** People with at least one signal / with each one. */
  withAny: number;
  signals: Record<Signal, number>;
  tone: Record<Sentiment, number>;
};

const zeroSignals = () =>
  Object.fromEntries(signals.map((s) => [s, 0])) as Record<Signal, number>;
const zeroTone = () =>
  Object.fromEntries(sentiments.map((s) => [s, 0])) as Record<
    Sentiment,
    number
  >;

/**
 * One row per question and side: substance (`substanceByQuestion`), the
 * people with each signal (`signalSummary` of that question and side) and the
 * tone of the free text (`toneByQuestion`).
 */
export async function readingByQuestion(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<QuestionSideRow[]> {
  const [substance, tone] = await Promise.all([
    substanceByQuestion(db, actor, f),
    toneByQuestion(db, actor, f),
  ]);
  const rows = new Map<string, QuestionSideRow>();
  const rowOf = (dimension: string, side: Side) => {
    const key = `${dimension}|${side}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        dimension,
        side,
        people: 0,
        substancePeople: 0,
        none: 0,
        generic: 0,
        specific: 0,
        withAny: 0,
        signals: zeroSignals(),
        tone: zeroTone(),
      };
      rows.set(key, row);
    }
    return row;
  };
  for (const s of substance) {
    Object.assign(rowOf(s.dimension, s.side), {
      substancePeople: s.people,
      none: s.none,
      generic: s.generic,
      specific: s.specific,
    });
  }
  for (const t of tone) {
    const row = rowOf(t.dimension, t.side);
    row.people = t.people;
    for (const s of sentiments) row.tone[s] = t[s];
  }
  const ordered = [...rows.values()].sort(
    (a, b) =>
      (a.dimension < b.dimension ? -1 : a.dimension > b.dimension ? 1 : 0) ||
      sideRank(a.side) - sideRank(b.side),
  );
  const summaries = await Promise.all(
    ordered.map((r) =>
      signalSummary(db, actor, {
        ...f,
        dimension: r.dimension,
        relationship: r.side,
      }),
    ),
  );
  ordered.forEach((row, i) => {
    const summary = summaries[i];
    if (!summary) return;
    row.withAny = summary.withAny;
    for (const s of summary.rows) row.signals[s.signal] = s.people;
  });
  return ordered;
}

// ------------------------------------------------------------- per group

export type GroupRow = {
  /** The area or attribute value; null: no value. */
  group: string | null;
  /** People with a read answer in the group. */
  people: number;
  withAny: number;
  signals: Record<Signal, number>;
  /** The manager's feedback of the group's people (the weaker of their two answers). */
  managerFeedback: {
    people: number;
    none: number;
    generic: number;
    specific: number;
  };
};

/**
 * One row per group (area, account, project, DM, Santex Lead): the people
 * with each signal (`signalsByGroup`) and the quality of the managers'
 * feedback (`managerFeedbackByGroup`).
 */
export async function readingByGroup(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
  groupBy: QualitativeGroupBy,
): Promise<GroupRow[]> {
  const [bySignal, byFeedback] = await Promise.all([
    signalsByGroup(db, actor, f, groupBy),
    managerFeedbackByGroup(db, actor, f, groupBy),
  ]);
  const rows = new Map<string, GroupRow>();
  const rowOf = (key: string | null, label: string | null) => {
    const id = key ?? "";
    let row = rows.get(id);
    if (!row) {
      row = {
        group: label,
        people: 0,
        withAny: 0,
        signals: zeroSignals(),
        managerFeedback: { people: 0, none: 0, generic: 0, specific: 0 },
      };
      rows.set(id, row);
    }
    return row;
  };
  for (const g of bySignal) {
    Object.assign(rowOf(g.key, g.label), {
      people: g.people,
      withAny: g.withAny,
      signals: g.counts,
    });
  }
  for (const g of byFeedback) {
    rowOf(g.key, g.label).managerFeedback = {
      people: g.people,
      none: g.none,
      generic: g.generic,
      specific: g.specific,
    };
  }
  return [...rows.values()];
}

// ---------------------------------------------------------------- yes / no

export type YesNoExportRow = {
  /** Null on the rows of the whole selection (no grouping). */
  group: string | null;
  dimension: string;
  prompt: LocalizedText;
  /** Null on the rows of a group (a question has one side in practice). */
  side: Side | null;
  yes: number;
  no: number;
  /** People who answered yes or no: the base of the shares. */
  people: number;
};

/**
 * Sí / No per question and side (`yesNoRates`), or per question and group
 * (`yesNoByGroup`) when `groupBy` is set. People who answered one or the other.
 */
export async function yesNoExportRows(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
  groupBy: QualitativeGroupBy | null,
): Promise<YesNoExportRow[]> {
  const rates = await yesNoRates(db, actor, f);
  if (!groupBy) {
    return rates.map((r) => ({
      group: null,
      dimension: r.dimension,
      prompt: r.prompt,
      side: r.side,
      yes: r.yes,
      no: r.no,
      people: r.people,
    }));
  }
  const promptOf = new Map(rates.map((r) => [r.dimension, r.prompt]));
  const groups = await yesNoByGroup(db, actor, f, groupBy);
  return groups.map((g) => ({
    group: g.label,
    dimension: g.dimension,
    prompt: promptOf.get(g.dimension) ?? { es: "", en: "" },
    side: null,
    yes: g.yes,
    no: g.no,
    people: g.people,
  }));
}

// -------------------------------------------------------- closed questions

export type ClosedExportRow = {
  section: "valued" | "not_valued" | "best_work";
  /** Null on the rows of the whole selection. */
  group: string | null;
  /** The value (1-4; "1-2" for the people who do not feel valued) or the option. */
  value: string;
  /** The question's choice in the file's language, when it has one. */
  label: string | null;
  people: number;
  /** People who answered the question: the base of the share. */
  base: number;
};

const valuedRows = (
  group: string | null,
  d: ValuedDistribution,
  locale: Locale,
): ClosedExportRow[] => [
  ...d.counts.map((people, i): ClosedExportRow => ({
    section: "valued",
    group,
    value: String(i + 1),
    label: d.labels[i]?.[locale] ?? null,
    people,
    base: d.people,
  })),
  {
    section: "not_valued",
    group,
    value: "1-2",
    label: null,
    people: d.notValued,
    base: d.people,
  },
];

/**
 * The closed questions as the screen reads them: "valued" as a 1-4 scale
 * (people per value and the ones at 1-2, for the whole selection and, with
 * `groupBy`, per group) and "best work" as people per option. Never a tone.
 */
export async function closedExportRows(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
  groupBy: QualitativeGroupBy | null,
  locale: Locale,
): Promise<ClosedExportRow[]> {
  const [valued, bestWork] = await Promise.all([
    valuedDistribution(db, actor, f, groupBy ?? undefined),
    bestWorkOptions(db, actor, f),
  ]);
  return [
    ...(valued.total ? valuedRows(null, valued.total, locale) : []),
    ...valued.byGroup.flatMap((g) => valuedRows(g.label, g, locale)),
    ...(bestWork?.options.map((o): ClosedExportRow => ({
      section: "best_work",
      group: null,
      value: o.option,
      label: o.label?.[locale] ?? null,
      people: o.people,
      base: bestWork.people,
    })) ?? []),
  ];
}
