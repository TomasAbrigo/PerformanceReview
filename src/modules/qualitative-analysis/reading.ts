import { type SQL, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { LocalizedText } from "@/db/schema/rating-scales";
import type { ActorContext } from "@/modules/actor/types";
import { groupKeyer } from "@/modules/org-attributes/group-key";
import { groupIdentity, needsKeyer } from "@/modules/org-attributes/kinds";
import { orgAttributeColumns } from "@/modules/org-attributes/sql";
import { yesNoAnswerSql } from "./analysis-text";
import { type Choice, choiceOfValue } from "./choices";
import {
  DEMO_PROVIDERS,
  IMPORT_PROVIDER,
  sentiments,
  type Sentiment,
  signals,
  type Signal,
} from "./constants";
import { AnalysisError } from "./errors";
import { pseudonymize } from "./pseudonymize";
import type {
  Agreement,
  BestWork,
  GroupSignals,
  GroupSubstance,
  Provenance,
  Side,
  SignalIndicatorRow,
  SignalSummary,
  SubstanceRow,
  ThemesBySide,
  ToneRow,
  ValuedDistribution,
  ValuedGroupRow,
  ValuedTrendRow,
  YesNoGroupRow,
  YesNoRow,
  YesNoThemes,
  YesNoTrendRow,
} from "./reading-types";
import {
  labeledCtes,
  minGroup,
  type Resolved,
  resolve,
  scopedAnswersSql,
} from "./scope";
import { pseudonymSources } from "./service";
import {
  type QualitativeFilters,
  type QualitativeGroupBy,
  qualitativeGroupBys,
} from "./types";
import { yesNoKindOf } from "./yes-no-kind";

/**
 * The open-text reading per PERSON (#129). Every reader goes through the
 * scope of scope.ts (who sees what, the double blind, direction's minimum
 * over distinct people) and counts people: each person once per question
 * and side, read at their latest cycle in the selection (`L` / `A` below);
 * within one cycle that is the participant. Self and manager never share a
 * row. Direction: a row (group, theme, value…) of fewer distinct people than
 * the minimum is left out.
 */

/** CTE `L`: one label per person, question and side (the latest). */
function personLabels(r: Resolved): SQL {
  return sql`${labeledCtes(r)},
    L as (
      select distinct on (person_id, dimension, relationship) *
      from labeled
      where relationship in ('self', 'manager')
      order by person_id, dimension, relationship, period_end desc, answer_id
    )`;
}

/** CTE `A`: one submitted answer per person, question and side (the latest), with its yes/no. */
function personAnswers(r: Resolved, where: SQL): SQL {
  return sql`ans as (
      select a.id as answer_id, a.option_value, a.option_label, a.text_value,
             coalesce(q.dimension, q.role::text) as dimension,
             q.role::text as role, q.prompt, q.choices,
             ${yesNoAnswerSql("a", "q")} as yes_no,
             r.relationship::text as relationship, r.cycle_id,
             c.name as cycle_name, c.period_end::text as period_end,
             cp.id as participant_id, cp.reviewee_person_id as person_id,
             p.display_name as person_name,
             cp.snap_department as department, ${orgAttributeColumns}
      ${scopedAnswersSql(r)} and r.relationship in ('self', 'manager') and ${where}
    ),
    A as (
      select distinct on (person_id, dimension, relationship) *
      from ans
      order by person_id, dimension, relationship, period_end desc, answer_id
    )`;
}

/** The SQL column of a grouping (only the known ones: it is part of the statement). */
function groupColumn(groupBy: QualitativeGroupBy): SQL {
  if (!(qualitativeGroupBys as readonly string[]).includes(groupBy)) {
    throw new AnalysisError("not_found");
  }
  return sql.raw(groupBy);
}

/** Key and label of each group row (direction: a DM / Santex Lead is an opaque key). */
async function identities<T extends { value: string | null }>(
  db: DbOrTx,
  r: Resolved,
  groupBy: QualitativeGroupBy,
  rows: T[],
): Promise<(T & { key: string | null; label: string | null })[]> {
  const masked = r.scope.kind === "aggregatesOnly";
  const keyOf =
    masked && needsKeyer(groupBy) ? await groupKeyer(db) : undefined;
  return rows.map((row) => ({
    ...row,
    ...(groupBy === "department"
      ? { key: row.value, label: row.value }
      : groupIdentity(groupBy, row.value, masked, keyOf)),
  }));
}

// ---- provenance ------------------------------------------------------------

/**
 * Where the labels in scope come from: how many a person corrected, imported
 * or a machine read (and with which provider and model), whether the
 * machine labels are the demo heuristic, and the latest run.
 */
export async function readingProvenance(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<Provenance | null> {
  const r = await resolve(db, actor, f);
  if (!r) return null;
  const rows = await db.execute<{
    origin: string;
    provider: string;
    model: string | null;
    n: number;
  }>(sql`
    with ${labeledCtes(r)}
    select origin, provider, model, count(*)::int as n
    from labeled group by 1, 2, 3 order by n desc`);
  const sum = (o: string) =>
    rows.filter((x) => x.origin === o).reduce((n, x) => n + x.n, 0);
  const machine = rows.filter((x) => x.origin === "machine");
  const [run] = await db.execute<{
    provider: string;
    model: string | null;
    finished_at: string;
  }>(sql`
    select provider, model, finished_at::text as finished_at
    from analysis_run
    where status = 'succeeded' and provider <> ${IMPORT_PROVIDER}
      and finished_at is not null
      ${f.cycleId ? sql`and (cycle_id is null or cycle_id = ${f.cycleId}::uuid)` : sql``}
    order by finished_at desc limit 1`);
  return {
    labels: rows.reduce((n, x) => n + x.n, 0),
    human: sum("human"),
    imported: sum("import"),
    machine: sum("machine"),
    demo:
      machine.length > 0 &&
      machine.every((x) => DEMO_PROVIDERS.includes(x.provider)),
    providers: machine.map((x) => ({
      provider: x.provider,
      model: x.model,
      labels: x.n,
    })),
    lastRun: run
      ? { provider: run.provider, model: run.model, finishedAt: run.finished_at }
      : null,
  };
}

// ---- substance ---------------------------------------------------------------

/** People per substance of their answer, per question and side. */
export async function substanceByQuestion(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<SubstanceRow[]> {
  const r = await resolve(db, actor, f);
  if (!r) return [];
  const rows = await db.execute<SubstanceRow & { side: Side }>(sql`
    with ${personLabels(r)}
    select dimension, relationship as side,
           count(distinct person_id) filter (where substance = 'none')::int as none,
           count(distinct person_id) filter (where substance = 'generic')::int as generic,
           count(distinct person_id) filter (where substance = 'specific')::int as specific,
           count(distinct person_id)::int as people
    from L where substance is not null
    group by 1, 2 ${minGroup(r.min)} order by 1, 2 desc`);
  return [...rows];
}

/**
 * The manager's feedback per group: each person by the weaker of the
 * manager's strengths and improvement answers (none < generic < specific).
 */
export async function managerFeedbackByGroup(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
  groupBy: QualitativeGroupBy,
): Promise<GroupSubstance[]> {
  const column = groupColumn(groupBy);
  const r = await resolve(db, actor, { ...f, relationship: "manager" });
  if (!r) return [];
  const rows = await db.execute<{
    value: string | null;
    none: number;
    generic: number;
    specific: number;
    people: number;
  }>(sql`
    with ${personLabels(r)},
    per as (
      select person_id, (array_agg(${column}))[1] as value,
             min(case substance when 'none' then 0 when 'generic' then 1 else 2 end) as level
      from L
      where dimension in ('strengths', 'improvement') and substance is not null
      group by person_id
    )
    select value,
           count(*) filter (where level = 0)::int as none,
           count(*) filter (where level = 1)::int as generic,
           count(*) filter (where level = 2)::int as specific,
           count(*)::int as people
    from per group by 1 ${minGroup(r.min)}
    order by (value is null), 1`);
  return (await identities(db, r, groupBy, [...rows])).map(
    ({ key, label, none, generic, specific, people }) => ({
      key,
      label,
      none,
      generic,
      specific,
      people,
    }),
  );
}

// ---- themes ------------------------------------------------------------------

/** Quotes read per theme and side to find 2 different representative ones. */
const QUOTE_POOL = 12;

/**
 * The themes of one question (strengths, improvement, the "how" of a yes/no
 * question…), self and manager side by side: people who cite each theme, the
 * people with a read answer per side (the denominators) and, for who may
 * read comments, representative quotes: answers about that theme alone
 * first, then the specific ones, in a fixed pseudo-random order (never the
 * shortest).
 */
export async function themesBySide(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters & { dimension: string },
  limit = 8,
): Promise<ThemesBySide> {
  const empty: ThemesBySide = {
    dimension: f.dimension,
    people: { self: 0, manager: 0 },
    rows: [],
  };
  const r = await resolve(db, actor, f);
  if (!r) return empty;
  const base = await db.execute<{ side: Side; people: number }>(sql`
    with ${personLabels(r)}
    select relationship as side, count(distinct person_id)::int as people
    from L where substance is distinct from 'none'
    group by 1 ${minGroup(r.min)}`);
  const rows = await db.execute<{
    theme: string;
    self: number;
    manager: number;
    self_quotes: string[] | null;
    manager_quotes: string[] | null;
  }>(sql`
    with ${personLabels(r)},
    t as (select unnest(themes) as theme, * from L)
    select theme,
           count(distinct person_id) filter (where relationship = 'self')::int as self,
           count(distinct person_id) filter (where relationship = 'manager')::int as manager,
           (array_agg(text order by cardinality(themes), (substance = 'specific') desc, md5(answer_id::text))
              filter (where relationship = 'self'))[1:${QUOTE_POOL}] as self_quotes,
           (array_agg(text order by cardinality(themes), (substance = 'specific') desc, md5(answer_id::text))
              filter (where relationship = 'manager'))[1:${QUOTE_POOL}] as manager_quotes
    from t group by theme ${minGroup(r.min)}
    order by count(distinct person_id) desc, theme limit ${limit}`);
  const sources = r.f.aggregateOnly ? null : await pseudonymSources(db);
  const quotes = (texts: string[] | null) =>
    sources && texts
      ? distinctTexts(pseudonymize(texts, sources).texts, 2)
      : [];
  const people = { self: 0, manager: 0 };
  for (const b of base) people[b.side] = b.people;
  return {
    dimension: f.dimension,
    people,
    rows: rows.map((row) => ({
      theme: row.theme,
      self: row.self,
      manager: row.manager,
      quotes: {
        self: quotes(row.self_quotes),
        manager: quotes(row.manager_quotes),
      },
    })),
  };
}

/** The first `n` different texts (ignoring case and spaces at the ends). */
export function distinctTexts(texts: readonly string[], n: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    const k = t.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t.trim());
    if (out.length === n) break;
  }
  return out;
}

// ---- agreement ---------------------------------------------------------------

/**
 * Person–manager agreement, from the themes of the two sides of the same
 * participant (strengths with strengths, improvement with improvement): of
 * the people whose two answers have themes, how many share at least one.
 * Blind spots: improvement themes the manager names and the person does not.
 */
export async function agreementBySide(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
  limit = 6,
): Promise<Agreement> {
  const empty: Agreement = {
    rows: [],
    blindSpots: [],
    blindPeople: 0,
    improvementBoth: 0,
  };
  // Both sides are needed: the side filter does not apply.
  const r = await resolve(db, actor, { ...f, relationship: undefined });
  if (!r) return empty;
  const pairs = sql`${labeledCtes(r)},
    s as (select * from labeled where relationship = 'self' and cardinality(themes) > 0
            and dimension in ('strengths', 'improvement')),
    m as (select * from labeled where relationship = 'manager' and cardinality(themes) > 0
            and dimension in ('strengths', 'improvement')),
    pairs as (
      select distinct on (s.person_id, s.dimension)
             s.person_id, s.dimension, s.themes as st, m.themes as mt
      from s join m on m.participant_id = s.participant_id and m.dimension = s.dimension
      order by s.person_id, s.dimension, s.period_end desc, s.answer_id, m.answer_id
    )`;
  const rows = await db.execute<{
    dimension: "strengths" | "improvement";
    both: number;
    shared: number;
    blind: number;
  }>(sql`
    with ${pairs}
    select dimension, count(*)::int as both,
           count(*) filter (where st && mt)::int as shared,
           count(*) filter (where not (mt <@ st))::int as blind
    from pairs group by 1 ${minGroup(r.min)} order by 1 desc`);
  const spots = await db.execute<{ theme: string; people: number }>(sql`
    with ${pairs},
    b as (select person_id, unnest(mt) as theme, st from pairs where dimension = 'improvement')
    select theme, count(distinct person_id)::int as people
    from b where not (theme = any(st))
    group by 1 ${minGroup(r.min)} order by 2 desc, 1 limit ${limit}`);
  const improvement = rows.find((x) => x.dimension === "improvement");
  return {
    rows: rows.map(({ dimension, both, shared }) => ({
      dimension,
      both,
      shared,
    })),
    blindSpots: [...spots],
    blindPeople: improvement?.blind ?? 0,
    improvementBoth: improvement?.both ?? 0,
  };
}

// ---- signals -----------------------------------------------------------------

const signalCount = (alias = "") =>
  sql.raw(
    signals
      .map(
        (s) =>
          `count(distinct person_id) filter (where '${s}' = any(${alias}signals))::int as ${s}`,
      )
      .join(", "),
  );

/** People with each signal (in any answer, either side), with its base. */
export async function signalSummary(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<SignalSummary | null> {
  const r = await resolve(db, actor, f);
  if (!r) return null;
  const [total] = await db.execute<{ people: number; with_any: number }>(sql`
    with ${personLabels(r)}
    select count(distinct person_id)::int as people,
           count(distinct person_id) filter (where cardinality(signals) > 0)::int as with_any
    from L ${minGroup(r.min)}`);
  if (!total) return null;
  const rows = await db.execute<{
    signal: Signal;
    people: number;
    self: number;
    manager: number;
  }>(sql`
    with ${personLabels(r)},
    s as (select unnest(signals) as signal, person_id, relationship from L)
    select signal, count(distinct person_id)::int as people,
           count(distinct person_id) filter (where relationship = 'self')::int as self,
           count(distinct person_id) filter (where relationship = 'manager')::int as manager
    from s group by 1 ${minGroup(r.min)} order by 2 desc, 1`);
  return { people: total.people, withAny: total.with_any, rows: [...rows] };
}

/** People with each signal per group (area, account…). */
export async function signalsByGroup(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
  groupBy: QualitativeGroupBy,
): Promise<GroupSignals[]> {
  const column = groupColumn(groupBy);
  const r = await resolve(db, actor, f);
  if (!r) return [];
  const rows = await db.execute<
    Record<Signal, number> & {
      value: string | null;
      people: number;
      with_any: number;
    }
  >(sql`
    with ${personLabels(r)}
    select ${column} as value, count(distinct person_id)::int as people,
           count(distinct person_id) filter (where cardinality(signals) > 0)::int as with_any,
           ${signalCount()}
    from L group by 1 ${minGroup(r.min)} order by (${column} is null), 1`);
  return (await identities(db, r, groupBy, [...rows])).map((row) => ({
    key: row.key,
    label: row.label,
    people: row.people,
    withAny: row.with_any,
    counts: Object.fromEntries(signals.map((s) => [s, row[s]])) as Record<
      Signal,
      number
    >,
  }));
}

/**
 * One row per person: their manager's retention / engagement answer (the
 * latest submitted manager review of the same participant) and whether any
 * of their read answers carries a signal; counted per value.
 */
export async function signalsVsIndicators(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<SignalIndicatorRow[]> {
  const r = await resolve(db, actor, f);
  if (!r) return [];
  const rows = await db.execute<{
    role: "retention" | "engagement";
    value: number;
    choices: Choice[] | null;
    people: number;
    with_signal: number;
  }>(sql`
    with ${personLabels(r)},
    per as (
      select distinct on (person_id) person_id, participant_id
      from L order by person_id, period_end desc
    ),
    sig as (
      select person_id, bool_or(cardinality(signals) > 0) as has from L group by 1
    ),
    ind as (
      select distinct on (r.participant_id, q.role)
             r.participant_id, q.role::text as role,
             a.option_value::int as value, q.choices
      from answer a
      join review_request r on r.id = a.request_id
      join question_revision q on q.id = a.question_revision_id
      where q.role::text in ('retention', 'engagement')
        and a.option_value in (1, 2, 3, 4, 5)
        and r.relationship = 'manager' and r.status = 'submitted' and r.deleted_at is null
      order by r.participant_id, q.role, r.submitted_at desc nulls last, r.id
    )
    select ind.role, ind.value, (array_agg(ind.choices))[1] as choices,
           count(distinct per.person_id)::int as people,
           count(distinct per.person_id) filter (where sig.has)::int as with_signal
    from per
    join sig on sig.person_id = per.person_id
    join ind on ind.participant_id = per.participant_id
    group by 1, 2 ${minGroup(r.min, sql`per.person_id`)} order by 1, 2 desc`);
  return rows.map((row) => ({
    role: row.role,
    value: row.value,
    label: choiceOfValue(row.choices, row.value)?.label ?? null,
    people: row.people,
    withSignal: row.with_signal,
  }));
}

// ---- yes/no ------------------------------------------------------------------

const YES_NO_QUESTION = sql`q.yes_no`;

/** Rate of Sí / No per yes/no question and side (people who answered either). */
export async function yesNoRates(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<YesNoRow[]> {
  const r = await resolve(db, actor, f);
  if (!r) return [];
  const rows = await db.execute<{
    dimension: string;
    side: Side;
    prompt: LocalizedText;
    yes: number;
    no: number;
    people: number;
  }>(sql`
    with ${personAnswers(r, YES_NO_QUESTION)}
    select dimension, relationship as side, (array_agg(prompt order by period_end desc))[1] as prompt,
           count(distinct person_id) filter (where yes_no = 'yes')::int as yes,
           count(distinct person_id) filter (where yes_no = 'no')::int as no,
           count(distinct person_id) filter (where yes_no is not null)::int as people
    from A group by 1, 2
    ${r.min > 1 ? sql`having count(distinct person_id) filter (where yes_no is not null) >= ${r.min}` : sql``}
    order by 2 desc, 1`);
  return rows.map((row) => ({ ...row, kind: yesNoKindOf(row.prompt) }));
}

/** Rate of Sí / No per yes/no question and group. */
export async function yesNoByGroup(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
  groupBy: QualitativeGroupBy,
): Promise<YesNoGroupRow[]> {
  const column = groupColumn(groupBy);
  const r = await resolve(db, actor, f);
  if (!r) return [];
  const rows = await db.execute<{
    dimension: string;
    value: string | null;
    yes: number;
    no: number;
    people: number;
  }>(sql`
    with ${personAnswers(r, YES_NO_QUESTION)}
    select dimension, ${column} as value,
           count(distinct person_id) filter (where yes_no = 'yes')::int as yes,
           count(distinct person_id) filter (where yes_no = 'no')::int as no,
           count(distinct person_id) filter (where yes_no is not null)::int as people
    from A where yes_no is not null group by 1, 2 ${minGroup(r.min)}
    order by 1, (${column} is null), 2`);
  return (await identities(db, r, groupBy, [...rows])).map(
    ({ dimension, key, label, yes, no, people }) => ({
      dimension,
      key,
      label,
      yes,
      no,
      people,
    }),
  );
}

/** Rate of Sí / No per yes/no question and cycle (every cycle). */
export async function yesNoTrend(
  db: DbOrTx,
  actor: ActorContext,
  f: Omit<QualitativeFilters, "cycleId">,
): Promise<YesNoTrendRow[]> {
  const r = await resolve(db, actor, { ...f, cycleId: undefined });
  if (!r) return [];
  const rows = await db.execute<{
    dimension: string;
    cycle_id: string;
    cycle_name: string;
    period_end: string;
    yes: number;
    no: number;
    people: number;
  }>(sql`
    with ${personAnswers(r, YES_NO_QUESTION)}
    select dimension, cycle_id, cycle_name, period_end,
           count(distinct person_id) filter (where yes_no = 'yes')::int as yes,
           count(distinct person_id) filter (where yes_no = 'no')::int as no,
           count(distinct person_id)::int as people
    from ans where yes_no is not null group by 1, 2, 3, 4 ${minGroup(r.min)}
    order by 1, period_end`);
  return rows.map((row) => ({
    dimension: row.dimension,
    cycleId: row.cycle_id,
    cycleName: row.cycle_name,
    periodEnd: row.period_end,
    yes: row.yes,
    no: row.no,
    people: row.people,
  }));
}

/** The themes (initiative types) of the "how" of each yes/no question. */
export async function yesNoThemes(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
  limit = 6,
): Promise<YesNoThemes[]> {
  const r = await resolve(db, actor, f);
  if (!r) return [];
  const base = await db.execute<{ dimension: string; people: number }>(sql`
    with ${personLabels(r)}
    select dimension, count(distinct person_id)::int as people
    from L where yes_no_question group by 1 ${minGroup(r.min)}`);
  const rows = await db.execute<{
    dimension: string;
    theme: string;
    people: number;
  }>(sql`
    with ${personLabels(r)},
    t as (select dimension, unnest(themes) as theme, person_id from L where yes_no_question)
    select dimension, theme, count(distinct person_id)::int as people
    from t group by 1, 2 ${minGroup(r.min)} order by 1, 3 desc, 2`);
  return base.map((b) => ({
    dimension: b.dimension,
    people: b.people,
    rows: rows
      .filter((x) => x.dimension === b.dimension)
      .slice(0, limit)
      .map(({ theme, people }) => ({ theme, people })),
  }));
}

// ---- closed questions --------------------------------------------------------

const VALUED = sql`q.role::text = 'valued' and a.option_value between 1 and 4`;

const valuedCols = sql`
  count(distinct person_id) filter (where option_value = 1)::int as v1,
  count(distinct person_id) filter (where option_value = 2)::int as v2,
  count(distinct person_id) filter (where option_value = 3)::int as v3,
  count(distinct person_id) filter (where option_value = 4)::int as v4,
  count(distinct person_id)::int as people,
  (array_agg(choices order by period_end desc))[1] as choices`;

type ValuedSql = {
  v1: number;
  v2: number;
  v3: number;
  v4: number;
  people: number;
  choices: Choice[] | null;
};

const distribution = (row: ValuedSql): ValuedDistribution => ({
  counts: [row.v1, row.v2, row.v3, row.v4],
  people: row.people,
  notValued: row.v1 + row.v2,
  labels: [1, 2, 3, 4].map((v) => choiceOfValue(row.choices, v)?.label ?? null),
});

/**
 * "How well does the company recognize my value?" (self, 1-4) as a scale:
 * people per value, the share at 1-2, per group and per cycle. Never read
 * as a sentiment.
 */
export async function valuedDistribution(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
  groupBy?: QualitativeGroupBy,
): Promise<{
  total: ValuedDistribution | null;
  byGroup: ValuedGroupRow[];
  trend: ValuedTrendRow[];
}> {
  const empty = { total: null, byGroup: [], trend: [] };
  const r = await resolve(db, actor, f);
  if (!r) return empty;
  const [total] = await db.execute<ValuedSql>(sql`
    with ${personAnswers(r, VALUED)}
    select ${valuedCols} from A ${minGroup(r.min)}`);
  let byGroup: ValuedGroupRow[] = [];
  if (groupBy) {
    const column = groupColumn(groupBy);
    const rows = await db.execute<ValuedSql & { value: string | null }>(sql`
      with ${personAnswers(r, VALUED)}
      select ${column} as value, ${valuedCols} from A
      group by 1 ${minGroup(r.min)} order by (${column} is null), 1`);
    byGroup = (await identities(db, r, groupBy, [...rows])).map((row) => ({
      key: row.key,
      label: row.label,
      ...distribution(row),
    }));
  }
  const rt = await resolve(db, actor, { ...f, cycleId: undefined });
  const trend = rt
    ? await db.execute<
        ValuedSql & { cycle_id: string; cycle_name: string; period_end: string }
      >(sql`
        with ${personAnswers(rt, VALUED)}
        select cycle_id, cycle_name, period_end, ${valuedCols} from ans
        group by 1, 2, 3 ${minGroup(rt.min)} order by period_end`)
    : [];
  return {
    total: total && total.people > 0 ? distribution(total) : null,
    byGroup,
    trend: trend.map((row) => ({
      cycleId: row.cycle_id,
      cycleName: row.cycle_name,
      periodEnd: row.period_end,
      ...distribution(row),
    })),
  };
}

/** "What would help me do my best work?": people per chosen option. */
export async function bestWorkOptions(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<BestWork | null> {
  const r = await resolve(db, actor, f);
  if (!r) return null;
  const where = sql`coalesce(q.dimension, '') = 'best_work' and q.kind = 'single_choice' and a.option_label is not null`;
  const [total] = await db.execute<{ people: number }>(sql`
    with ${personAnswers(r, where)}
    select count(distinct person_id)::int as people from A ${minGroup(r.min)}`);
  if (!total || total.people === 0) return null;
  const rows = await db.execute<{
    option: string;
    people: number;
    choices: Choice[] | null;
  }>(sql`
    with ${personAnswers(r, where)}
    select option_label as option, count(distinct person_id)::int as people,
           (array_agg(choices order by period_end desc))[1] as choices
    from A group by 1 ${minGroup(r.min)} order by 2 desc, 1`);
  return {
    people: total.people,
    options: rows.map((row) => ({
      option: row.option,
      label: row.choices?.find((c) => c.value === row.option)?.label ?? null,
      people: row.people,
    })),
  };
}

// ---- tone --------------------------------------------------------------------

/** The tone of the free text per question and side (people per tone). */
export async function toneByQuestion(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<ToneRow[]> {
  const r = await resolve(db, actor, f);
  if (!r) return [];
  const cols = sql.raw(
    sentiments
      .map(
        (s) =>
          `count(distinct person_id) filter (where sentiment = '${s}')::int as ${s}`,
      )
      .join(", "),
  );
  const rows = await db.execute<
    Record<Sentiment, number> & { dimension: string; side: Side; people: number }
  >(sql`
    with ${personLabels(r)}
    select dimension, relationship as side, ${cols},
           count(distinct person_id)::int as people
    from L group by 1, 2 ${minGroup(r.min)} order by 1, 2 desc`);
  return [...rows];
}

// ---- drill: the answers to a yes/no question -----------------------------------

export type YesNoAnswerRow = {
  answerId: string;
  personName: string;
  dimension: string;
  text: string;
};

/**
 * The answers (as typed) of the people who said `yesNo` to a yes/no question,
 * for the drill: the count of people (direction: masked under the minimum)
 * and, for who may read them, the answers.
 */
export async function yesNoAnswers(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters & { dimension: string; yesNo: "yes" | "no" },
  limit = 200,
): Promise<{ people: number | null; rows: YesNoAnswerRow[] }> {
  const r = await resolve(db, actor, { ...f, dimension: undefined });
  if (!r) return { people: null, rows: [] };
  const where = sql`q.yes_no and coalesce(q.dimension, q.role::text) = ${f.dimension}`;
  const [count] = await db.execute<{ people: number }>(sql`
    with ${personAnswers(r, where)}
    select count(distinct person_id)::int as people from A
    where yes_no = ${f.yesNo} ${minGroup(r.min)}`);
  const people = count?.people ?? (r.min > 1 ? null : 0);
  if (r.f.aggregateOnly) return { people, rows: [] };
  const rows = await db.execute<{
    answer_id: string;
    person_name: string;
    dimension: string;
    text: string | null;
    option_label: string | null;
  }>(sql`
    with ${personAnswers(r, where)}
    select answer_id, person_name, dimension, text_value as text, option_label
    from A where yes_no = ${f.yesNo}
    order by person_name, answer_id limit ${limit}`);
  return {
    people,
    rows: rows.map((row) => ({
      answerId: row.answer_id,
      personName: row.person_name,
      dimension: row.dimension,
      text: row.text ?? row.option_label ?? "",
    })),
  };
}
