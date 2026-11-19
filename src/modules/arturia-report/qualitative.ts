// The qualitative section of the report: the open-text reading of a cycle
// (#128, #129), read through the same functions as /insights/qualitative
// (`qualitative-analysis/reading.ts`), so the report says the same numbers as
// the screen for that cycle. Nothing here re-derives a rule or a query: it
// calls the readers, localizes names, and (anonymized) publishes only what
// `qualitative-privacy.ts` lets it.
//
// The named report reads as People; the anonymized one as direction with the
// report's minimum (aggregates only: no quote, no name; a row of fewer
// distinct people than the minimum is left out by the readers themselves).
// Anonymized, the readers that feed a cut by group (area, account, DM) or a
// list whose sum is public are asked with a minimum of 1 and the small
// groups and cells are folded or hidden here, so nothing hidden can be
// subtracted from what is shown.
import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import {
  dimensionPrompts,
  qualitativeUniverse,
  type GroupSignals,
  type GroupSubstance,
  type QualitativeFilters,
  type QualitativeGroupBy,
  signals as SIGNALS,
} from "@/modules/qualitative-analysis";
import {
  agreementBySide,
  bestWorkOptions,
  managerFeedbackByGroup,
  readingProvenance,
  signalSummary,
  signalsByGroup,
  substanceByQuestion,
  themesBySide,
  toneByQuestion,
  valuedDistribution,
  yesNoRates,
  yesNoThemes,
} from "@/modules/qualitative-analysis/reading";
import { ALERT_KINDS } from "@/modules/qualitative-analysis/yes-no-kind";
import { sumBy } from "./anonymize";
import type { LocalizedText } from "@/db/schema/rating-scales";
import {
  type Labels,
  questionLabel,
  type ReportLocale,
  santexQuestionName,
} from "./labels";
import {
  type CutGroup,
  foldCut,
  hideSmall,
  maskCells,
  maskColumns,
  maskPair,
} from "./qualitative-privacy";
import type { QualitativeSection } from "./schema";

/** What the section needs of the report's context (`CollectContext` has it). */
export type QualitativeContext = {
  cycleId: string;
  anonymized: boolean;
  /** Smallest group published: the report's minimum when anonymized, else 1. */
  min: number;
  locale?: ReportLocale;
  labels: Labels;
  /** "DM N" of each DM of the cycle by its opaque key (what direction gets instead of a name). */
  dms: ReadonlyMap<string, string>;
};

/** The cuts by group the report already has and the readers know (area, account, DM). */
const CUTS = [
  "department",
  "account",
  "dm",
] as const satisfies readonly QualitativeGroupBy[];

/**
 * The key of a yes/no question's row: its dimension, which the cycles an
 * import creates carry (`custom_<slug>_<hash>`) but the questions of the
 * app's own template do not (the reader gives null): then a stable key made
 * of what the question asks.
 */
export function yesNoKey(r: {
  dimension: string | null;
  prompt: LocalizedText;
}): string {
  if (r.dimension) return r.dimension;
  const asked = santexQuestionName(r.prompt, "en") ?? r.prompt.en;
  const slug = asked
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `yes_no_${slug}`;
}

/** An ISO 8601 instant from Postgres' timestamptz text; the text itself when it does not parse. */
export function isoOf(text: string): string {
  const t = new Date(
    text.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"),
  ).getTime();
  return Number.isNaN(t) ? text : new Date(t).toISOString();
}

const groupLabel = (
  g: { key: string | null; label: string | null },
  ctx: QualitativeContext,
) =>
  g.label ??
  (g.key === null ? undefined : ctx.dms.get(g.key)) ??
  ctx.labels.others;

type FeedbackCut = QualitativeSection["managerFeedback"]["byDepartment"];
type SignalCut = NonNullable<QualitativeSection["signals"]>["byDepartment"];

/** The manager's feedback by group: small groups folded, each row's cells masked. */
function feedbackCut(
  rows: GroupSubstance[],
  ctx: QualitativeContext,
): FeedbackCut {
  type Cells = { none: number; generic: number; specific: number };
  const groups: CutGroup<Cells>[] = rows.map((r) => ({
    key: r.key,
    label: groupLabel(r, ctx),
    people: r.people,
    cells: { none: r.none, generic: r.generic, specific: r.specific },
  }));
  const { shown, others, suppressed } = foldCut(groups, ctx.min, (rest) => ({
    key: null,
    label: ctx.labels.others,
    people: sumBy(rest, (g) => g.people),
    cells: {
      none: sumBy(rest, (g) => g.cells.none),
      generic: sumBy(rest, (g) => g.cells.generic),
      specific: sumBy(rest, (g) => g.cells.specific),
    },
  }));
  let leftOut = suppressed;
  const out: FeedbackCut["groups"] = [];
  for (const g of [...shown, ...(others ? [others] : [])]) {
    const cells = maskCells(
      [g.cells.none, g.cells.generic, g.cells.specific],
      ctx.min,
    );
    if (!cells) {
      leftOut += g.people;
      continue;
    }
    out.push({
      label: g.label,
      other: g.key === null,
      people: g.people,
      none: cells[0],
      generic: cells[1],
      specific: cells[2],
    });
  }
  return { groups: out, suppressed: leftOut };
}

/** People with each signal by group: small groups folded, every column masked (its total is public). */
function signalsCut(rows: GroupSignals[], ctx: QualitativeContext): SignalCut {
  type Cells = { withAny: number; counts: Record<string, number> };
  const groups: CutGroup<Cells>[] = rows.map((r) => ({
    key: r.key,
    label: groupLabel(r, ctx),
    people: r.people,
    cells: { withAny: r.withAny, counts: r.counts },
  }));
  const { shown, others, suppressed } = foldCut(groups, ctx.min, (rest) => ({
    key: null,
    label: ctx.labels.others,
    people: sumBy(rest, (g) => g.people),
    cells: {
      withAny: sumBy(rest, (g) => g.cells.withAny),
      counts: Object.fromEntries(
        SIGNALS.map((s) => [s, sumBy(rest, (g) => g.cells.counts[s] ?? 0)]),
      ),
    },
  }));
  const all = [...shown, ...(others ? [others] : [])];
  const masked = maskColumns(
    all.map((g) => [
      g.cells.withAny,
      ...SIGNALS.map((s) => g.cells.counts[s] ?? 0),
    ]),
    ctx.min,
  );
  return {
    groups: all.map((g, i) => ({
      label: g.label,
      other: g.key === null,
      people: g.people,
      withAny: masked[i][0],
      counts: Object.fromEntries(SIGNALS.map((s, j) => [s, masked[i][j + 1]])),
    })),
    suppressed,
  };
}

/**
 * The qualitative section of the cycle for `actor` (People for the named
 * report, direction for the anonymized one). null when nobody has a read
 * answer, or (direction) when fewer people than the minimum do.
 */
export async function readQualitative(
  db: DbOrTx,
  ctx: QualitativeContext,
  actor: ActorContext,
): Promise<QualitativeSection | null> {
  const locale = ctx.locale ?? "es";
  // The readers' own rule (people under the minimum are left out) ...
  const rule: QualitativeFilters = {
    cycleId: ctx.cycleId,
    minGroupSize: ctx.min,
  };
  // ... and the unmasked reading of what this layer folds or masks itself.
  const raw: QualitativeFilters = { cycleId: ctx.cycleId, minGroupSize: 1 };
  const universe = await qualitativeUniverse(db, actor, rule);
  if (universe.masked || !universe.people) return null;
  const { min } = ctx;
  const [
    provenance,
    substanceRows,
    strengths,
    improvement,
    agreement,
    signalSum,
    yesNoRows,
    initiatives,
    valued,
    bestWork,
    toneRows,
    prompts,
    feedback,
    signalGroups,
  ] = await Promise.all([
    readingProvenance(db, actor, rule),
    substanceByQuestion(db, actor, rule),
    themesBySide(db, actor, { ...rule, dimension: "strengths" }),
    themesBySide(db, actor, { ...rule, dimension: "improvement" }),
    agreementBySide(db, actor, rule),
    signalSummary(db, actor, rule),
    yesNoRates(db, actor, rule),
    yesNoThemes(db, actor, rule),
    valuedDistribution(db, actor, rule),
    bestWorkOptions(db, actor, raw),
    toneByQuestion(db, actor, rule),
    dimensionPrompts(db),
    Promise.all(CUTS.map((g) => managerFeedbackByGroup(db, actor, raw, g))),
    Promise.all(CUTS.map((g) => signalsByGroup(db, actor, raw, g))),
  ]);

  // --- substance
  const substance = substanceRows.flatMap((r) => {
    const cells = maskCells([r.none, r.generic, r.specific], min);
    return cells
      ? [
          {
            dimension: r.dimension,
            side: r.side,
            people: r.people,
            none: cells[0],
            generic: cells[1],
            specific: cells[2],
          },
        ]
      : [];
  });

  // --- themes of strengths and improvement
  const base = (n: number) => (min > 1 && n === 0 ? null : n);
  const themes = [strengths, improvement].map((t) => ({
    dimension: t.dimension,
    people: { self: base(t.people.self), manager: base(t.people.manager) },
    rows: t.rows.map((r) => ({
      theme: r.theme,
      self: base(t.people.self) === null ? null : hideSmall(r.self, min),
      manager:
        base(t.people.manager) === null ? null : hideSmall(r.manager, min),
      // The anonymized report carries no verbatim quote: a text can tell
      // who wrote it even with the names replaced.
      quotes: ctx.anonymized
        ? { self: [], manager: [] }
        : { self: r.quotes.self, manager: r.quotes.manager },
    })),
  }));

  // --- agreement
  const hasImprovement = agreement.improvementBoth > 0;
  const hidePair = min > 1 && !hasImprovement;
  const agreementOut = {
    rows: agreement.rows.map((r) => ({
      dimension: r.dimension,
      both: r.both,
      shared: maskPair(r.shared, r.both, min),
    })),
    blindSpots: agreement.blindSpots,
    blindPeople: hidePair
      ? null
      : maskPair(agreement.blindPeople, agreement.improvementBoth, min),
    improvementBoth: hidePair ? null : agreement.improvementBoth,
  };

  // --- signals
  const signals = signalSum && {
    people: signalSum.people,
    withAny: maskPair(signalSum.withAny, signalSum.people, min),
    rows: signalSum.rows.map((r) => ({
      signal: r.signal,
      people: r.people,
      self: hideSmall(r.self, min),
      manager: hideSmall(r.manager, min),
    })),
    byDepartment: signalsCut(signalGroups[0], ctx),
    byAccount: signalsCut(signalGroups[1], ctx),
    byDm: signalsCut(signalGroups[2], ctx),
  };

  // --- yes / no
  const yesNo = {
    rows: yesNoRows.flatMap((r) => {
      const cells = maskCells([r.yes, r.no], min);
      if (!cells) return [];
      const [yes, no] = cells;
      return [
        {
          dimension: yesNoKey(r),
          side: r.side,
          kind: r.kind,
          people: r.people,
          yes,
          no,
          alert: ALERT_KINDS.includes(r.kind) && no !== null && no > 0,
        },
      ];
    }),
    initiatives: initiatives.map((i) => ({
      dimension: i.dimension,
      people: i.people,
      rows: i.rows,
    })),
  };

  // --- closed questions
  const v = valued.total;
  const valuedCells = v ? maskCells(v.counts, min) : null;
  const hidden = (i: number) => valuedCells !== null && valuedCells[i] === null;
  const hidden12 = [0, 1].filter(hidden).length;
  const hidden34 = [2, 3].filter(hidden).length;
  const bestCells =
    bestWork && bestWork.people >= min
      ? maskCells(
          bestWork.options.map((o) => o.people),
          min,
        )
      : null;
  const closed = {
    valued:
      v && valuedCells
        ? {
            people: v.people,
            counts: valuedCells,
            labels: v.labels.map((l) => l?.[locale] ?? null),
            // The sum of the first two values gives away a hidden one next to a shown one.
            notValued:
              hidden12 === 0 || (hidden12 === 2 && hidden34 === 0)
                ? v.notValued
                : null,
          }
        : null,
    bestWork:
      bestWork && bestWork.people >= min
        ? {
            people: bestWork.people,
            options: bestWork.options.map((o, i) => ({
              option: o.option,
              label: o.label?.[locale] ?? null,
              people: bestCells ? bestCells[i] : null,
            })),
          }
        : null,
  };

  // --- tone (secondary)
  const tone = toneRows.flatMap((r) => {
    const cells = maskCells(
      [r.positive, r.constructive, r.neutral, r.mixed, r.negative],
      min,
    );
    return cells
      ? [
          {
            dimension: r.dimension,
            side: r.side,
            people: r.people,
            positive: cells[0],
            constructive: cells[1],
            neutral: cells[2],
            mixed: cells[3],
            negative: cells[4],
          },
        ]
      : [];
  });

  // --- the name of every question mentioned, in the report's language
  const promptOf: Record<string, (typeof yesNoRows)[number]["prompt"]> = {
    ...prompts,
    ...Object.fromEntries(yesNoRows.map((r) => [yesNoKey(r), r.prompt])),
  };
  const dimensions = new Set<string>([
    "strengths",
    "improvement",
    ...substance.map((r) => r.dimension),
    ...tone.map((r) => r.dimension),
    ...yesNo.rows.map((r) => r.dimension),
    ...yesNo.initiatives.map((r) => r.dimension),
  ]);

  return {
    people: universe.people ?? 0,
    provenance: {
      labels: provenance?.labels ?? 0,
      human: provenance?.human ?? 0,
      imported: provenance?.imported ?? 0,
      machine: provenance?.machine ?? 0,
      correctedShare: provenance?.labels
        ? provenance.human / provenance.labels
        : null,
      demo: provenance?.demo ?? false,
      providers: provenance?.providers ?? [],
      lastRun: provenance?.lastRun
        ? {
            provider: provenance.lastRun.provider,
            model: provenance.lastRun.model,
            finishedAt: isoOf(provenance.lastRun.finishedAt),
          }
        : null,
    },
    questions: [...dimensions].sort().map((dimension) => ({
      dimension,
      label: questionLabel(dimension, promptOf[dimension], locale),
    })),
    substance,
    managerFeedback: {
      byDepartment: feedbackCut(feedback[0], ctx),
      byAccount: feedbackCut(feedback[1], ctx),
      byDm: feedbackCut(feedback[2], ctx),
    },
    themes,
    agreement: agreementOut,
    signals,
    yesNo,
    closed,
    tone,
  };
}
