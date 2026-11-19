import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { LocalizedText } from "@/db/schema/rating-scales";
import type { ActorContext } from "@/modules/actor/types";
import {
  sentiments,
  type Sentiment,
  type Signal,
  type Substance,
} from "./constants";
import { INITIAL_THEMES } from "./themes";
import { groupKeyer } from "@/modules/org-attributes/group-key";
import { groupIdentity, needsKeyer } from "@/modules/org-attributes/kinds";
import { AnalysisError } from "./errors";
import { choiceOfValue } from "./choices";
import { labeledCtes, minGroup, resolve } from "./scope";
import { questionKeySql } from "./reading";

export { qualitativeUniverse, type Universe } from "./scope";
import { pseudonymize } from "./pseudonymize";
import { pseudonymSources } from "./service";
import {
  type CommentRow,
  type DimensionSentiment,
  type GroupSentiment,
  type IndicatorSentiment,
  type ParticipantSentiment,
  pickCounts,
  type QualitativeFilterOptions,
  type QualitativeGroupBy,
  type QualitativeFilters,
  qualitativeGroupBys,
  type SentimentCounts,
  type ThemeRank,
  type TrendPoint,
} from "./types";

const countCols = sql.raw(
  sentiments
    .map((s) => `count(*) filter (where sentiment = '${s}')::int as ${s}`)
    .join(", "),
);
const counts = pickCounts;

/** Sentiment counts per dimension (stacked bars). */
export async function sentimentByDimension(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<DimensionSentiment[]> {
  const r = await resolve(db, actor, f);
  if (!r) return [];
  const rows = await db.execute<SentimentCounts & { dimension: string }>(sql`
    with ${labeledCtes(r)}
    select dimension, ${countCols}, count(*)::int as total
    from labeled group by dimension ${minGroup(r.min)} order by dimension`);
  return rows.map((r) => ({ dimension: r.dimension, ...counts(r) }));
}

/**
 * The sentiment of the comments (free text only, as everywhere since #128)
 * of each participant in scope, in
 * every cycle, for views that build their own groups out of people (the DM
 * cards, `dm360`). The rows are people: whoever reads them aggregates and
 * masks. Direction is authorized like everywhere (it reads aggregates), so
 * its callers must never show a row; People: every participant; a manager:
 * their direct reports of the snapshot; an employee: nothing.
 */
export async function sentimentByParticipant(
  db: DbOrTx,
  actor: ActorContext,
  f: Pick<QualitativeFilters, "cycleId" | "cycleIds" | "relationship"> = {},
): Promise<ParticipantSentiment[]> {
  const r = await resolve(db, actor, f);
  if (!r) return [];
  const rows = await db.execute<SentimentCounts & { participant_id: string }>(
    sql`
    with ${labeledCtes(r)}
    select participant_id, ${countCols}, count(*)::int as total
    from labeled group by participant_id`,
  );
  return rows.map((row) => ({
    participantId: row.participant_id,
    ...counts(row),
  }));
}

/**
 * Sentiment counts per group of people: their area or an org attribute
 * (account, project, DM, Santex Lead, as of each cycle's snapshot), with how
 * many people are behind each. People see every label and name the groups; a
 * manager the labels about their direct reports; direction groups of at least
 * `aggregation.minGroupSize` people, and a DM or Santex Lead is a team (an
 * opaque key, no label), never a name.
 */
export async function sentimentByGroup(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
  groupBy: QualitativeGroupBy,
): Promise<GroupSentiment[]> {
  // The column is part of the statement: only the known groupings.
  if (!(qualitativeGroupBys as readonly string[]).includes(groupBy)) {
    throw new AnalysisError("not_found");
  }
  const r = await resolve(db, actor, f);
  if (!r) return [];
  const column = sql.raw(groupBy);
  const rows = await db.execute<
    SentimentCounts & { value: string | null; participants: number }
  >(sql`
    with ${labeledCtes(r)}
    select ${column} as value, ${countCols}, count(*)::int as total,
           count(distinct person_id)::int as participants
    from labeled group by 1 ${minGroup(r.min)}
    order by (${column} is null), 1`);
  const masked = r.scope.kind === "aggregatesOnly";
  const keyOf =
    masked && needsKeyer(groupBy) ? await groupKeyer(db) : undefined;
  return rows.map((row) => ({
    ...(groupBy === "department"
      ? { key: row.value, label: row.value }
      : groupIdentity(groupBy, row.value, masked, keyOf)),
    participants: row.participants,
    ...counts(row),
  }));
}

/**
 * Sentiment counts of everything in scope (the KPIs). Direction: null when
 * fewer than `aggregation.minGroupSize` people are behind them.
 */
export async function sentimentTotals(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<SentimentCounts | null> {
  const r = await resolve(db, actor, f);
  if (!r) return null;
  const rows = await db.execute<SentimentCounts>(sql`
    with ${labeledCtes(r)}
    select ${countCols}, count(*)::int as total
    from labeled ${minGroup(r.min)}`);
  return rows[0] ? counts(rows[0]) : null;
}

/** Sentiment counts per cycle, ordered by period (all cycles). */
export async function sentimentTrend(
  db: DbOrTx,
  actor: ActorContext,
  f: Omit<QualitativeFilters, "cycleId">,
): Promise<TrendPoint[]> {
  const r = await resolve(db, actor, { ...f, cycleId: undefined });
  if (!r) return [];
  const rows = await db.execute<
    SentimentCounts & {
      cycle_id: string;
      cycle_name: string;
      period_end: string;
    }
  >(sql`
    with ${labeledCtes(r)}
    select cycle_id, cycle_name, period_end, ${countCols}, count(*)::int as total
    from labeled group by 1, 2, 3 ${minGroup(r.min)} order by period_end, cycle_name`);
  return rows.map((row) => ({
    cycleId: row.cycle_id,
    cycleName: row.cycle_name,
    periodEnd: row.period_end,
    ...counts(row),
  }));
}

/** Most frequent themes, each with up to 3 distinct pseudonymized example quotes. */
export async function topThemes(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
  limit = 10,
): Promise<ThemeRank[]> {
  const r = await resolve(db, actor, f);
  if (!r) return [];
  const rows = await db.execute<
    SentimentCounts & { theme: string; count: number; quotes: string[] }
  >(sql`
    with ${labeledCtes(r)},
    t as (select unnest(themes) as theme, text, answer_id, person_id, sentiment from labeled)
    select theme, count(*)::int as count, ${countCols}, count(*)::int as total,
           (array_agg(text order by length(text), answer_id))[1:${QUOTE_POOL}] as quotes
    from t group by theme ${minGroup(r.min)}
    order by count desc, theme limit ${limit}`);
  const sources = r.f.aggregateOnly ? null : await pseudonymSources(db);
  return rows.map((row) => ({
    theme: row.theme,
    count: row.count,
    sentiment: counts(row),
    quotes: sources
      ? distinctQuotes(pseudonymize(row.quotes, sources).texts)
      : [],
  }));
}

/** Shortest comments read to find 3 different quotes (many repeat). */
const QUOTE_POOL = 40;

/** The first 3 different quotes (ignoring case and spaces at the ends). */
export function distinctQuotes(texts: readonly string[], n = 3): string[] {
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

/**
 * Sentiment of a person's comments in a cycle against their answers to the
 * retention / engagement questions (question_revision.role).
 */
export async function sentimentVsIndicators(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<IndicatorSentiment[]> {
  const r = await resolve(db, actor, f);
  if (!r) return [];
  const rows = await db.execute<
    SentimentCounts & {
      role: string;
      value: number;
      choices: { value: string; label: LocalizedText }[] | null;
    }
  >(sql`
    with ${labeledCtes(r)},
    ind as (
      -- One value per participant and indicator: the latest submitted
      -- manager review's answer (so each comment is counted once).
      select distinct on (r.participant_id, q.role)
             r.participant_id, r.cycle_id, q.role::text as role,
             a.option_value::int as value, q.choices, c.period_end
      from answer a
      join review_request r on r.id = a.request_id
      join review_cycle c on c.id = r.cycle_id
      join question_revision q on q.id = a.question_revision_id
      where q.role::text in ('retention', 'engagement')
        and a.option_value in (1, 2, 3, 4, 5)
        and r.relationship = 'manager' and r.status = 'submitted' and r.deleted_at is null
      order by r.participant_id, q.role, r.submitted_at desc nulls last, r.id
    )
    select ind.role, ind.value,
           (array_agg(ind.choices order by ind.period_end desc))[1] as choices,
           ${countCols}, count(*)::int as total
    from labeled l
    join ind on ind.participant_id = l.participant_id and ind.cycle_id = l.cycle_id
    group by 1, 2 ${minGroup(r.min, sql`l.person_id`)} order by 1, 2 desc`);
  return rows.map((r) => ({
    role: r.role,
    value: r.value,
    label: choiceOfValue(r.choices, r.value)?.label ?? null,
    ...counts(r),
  }));
}

/** The labeled comments themselves (never in the aggregate view). */
export async function listComments(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
  limit = 200,
): Promise<CommentRow[]> {
  const r = await resolve(db, actor, f);
  if (!r || r.f.aggregateOnly) return [];
  const rows = await db.execute<{
    answer_id: string;
    cycle_name: string;
    period_start: string;
    period_end: string;
    person_name: string;
    relationship: string;
    dimension: string;
    text: string;
    sentiment: Sentiment;
    themes: string[];
    substance: Substance | null;
    signals: Signal[] | null;
    confidence: number | null;
    source: string;
    demo: boolean;
  }>(sql`
    with ${labeledCtes(r)}
    select answer_id, cycle_name, period_start, period_end, person_name,
           relationship, dimension, text, sentiment, themes, substance,
           signals, confidence, source, demo
    from labeled order by period_end desc, person_name, dimension, answer_id
    limit ${limit}`);
  return rows.map((r) => ({
    answerId: r.answer_id,
    cycleName: r.cycle_name,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    personName: r.person_name,
    relationship: r.relationship,
    dimension: r.dimension,
    text: r.text,
    sentiment: r.sentiment,
    themes: r.themes,
    substance: r.substance,
    signals: r.signals ?? [],
    confidence: r.demo ? null : r.confidence,
    source: r.source,
    demo: r.demo,
  }));
}

/**
 * Dimensions and themes present, for the filters. The themes are the initial
 * vocabulary plus whatever the analysis added.
 */
export async function qualitativeFilterOptions(
  db: DbOrTx,
): Promise<QualitativeFilterOptions> {
  const dims = await db.execute<{ d: string }>(
    sql`select distinct dimension as d from qualitative_analysis order by 1`,
  );
  const themes = await db.execute<{ t: string }>(
    sql`select distinct normalized_name as t from theme order by 1`,
  );
  const deps = await db.execute<{ d: string }>(
    sql`select distinct snap_department as d from cycle_participant where snap_department is not null order by 1`,
  );
  return {
    dimensions: dims.map((r) => r.d),
    themes: [...new Set([...INITIAL_THEMES, ...themes.map((r) => r.t)])].sort(),
    departments: deps.map((r) => r.d),
    dimensionPrompts: await dimensionPrompts(db),
  };
}

/**
 * Prompt of the latest question of each labeled dimension: the label of the
 * dimensions that have no name of their own.
 */
export async function dimensionPrompts(
  db: DbOrTx,
): Promise<Record<string, LocalizedText>> {
  const rows = await db.execute<{ d: string; prompt: LocalizedText }>(sql`
    select distinct on (d) ${questionKeySql("q")} as d, q.prompt
    from question_revision q
    join review_cycle c on c.id = q.cycle_id
    where q.dimension is not null or q.yes_no
    order by d, c.period_end desc, q.sort, q.id`);
  return Object.fromEntries(rows.map((r) => [r.d, r.prompt]));
}
