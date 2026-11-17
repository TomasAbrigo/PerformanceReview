import { type SQL, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { LocalizedText } from "@/db/schema/rating-scales";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { sentiments, type Sentiment } from "./constants";
import { analysisTextSql } from "./analysis-text";
import { effectiveCte } from "./effective";
import { INITIAL_THEMES } from "./themes";
import { insightsScope, type InsightsScope } from "@/modules/insights/authz";
import { getSetting } from "@/modules/settings/service";
import { AnalysisError } from "./errors";
import { pseudonymize } from "./pseudonymize";
import { pseudonymSources } from "./service";
import {
  type CommentRow,
  type DimensionSentiment,
  type IndicatorSentiment,
  pickCounts,
  type QualitativeFilterOptions,
  type QualitativeFilters,
  type SentimentCounts,
  type ThemeRank,
  type TrendPoint,
} from "./types";

/**
 * Who sees what (insightsScope): People every label; a manager the labels
 * about their direct reports at the cycle snapshot; direction aggregates only,
 * groups of fewer than `aggregation.minGroupSize` people left out; an employee
 * nothing (never their own labels). aggregateOnly (also People's toggle)
 * keeps counts and drops comments and quotes.
 */
type Resolved = {
  scope: InsightsScope;
  f: QualitativeFilters;
  min: number;
  includeClosed: boolean;
};

async function resolve(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<Resolved | null> {
  const scope = insightsScope(
    actor,
    actor.role === "direction"
      ? (f.minGroupSize ?? (await getSetting(db, "aggregation.minGroupSize")))
      : undefined,
  );
  if (scope.kind === "none") return null;
  const includeClosed =
    f.includeClosed ?? (await getSetting(db, "analysis.includeClosed"));
  if (scope.kind === "aggregatesOnly") {
    return {
      scope,
      f: { ...f, aggregateOnly: true },
      min: scope.minGroupSize,
      includeClosed,
    };
  }
  return { scope, f, min: 0, includeClosed };
}

/** Groups with fewer distinct participants than `min` are left out. */
const minGroup = (min: number, col = sql`participant_id`) =>
  min > 1 ? sql`having count(distinct ${col}) >= ${min}` : sql``;

/** CTEs eff + labeled: effective labels of submitted answers in scope. */
function labeledCtes({ scope, f, includeClosed }: Resolved): SQL {
  const where: SQL[] = [
    sql`r.deleted_at is null`,
    sql`r.status = 'submitted'`,
    sql`cp.removed_at is null`,
  ];
  if (!includeClosed) where.push(sql`eff.kind = 'text'`);
  if (f.cycleId) {
    if (!isUuid(f.cycleId)) throw new AnalysisError("not_found");
    where.push(sql`r.cycle_id = ${f.cycleId}::uuid`);
  }
  if (f.department) where.push(sql`cp.snap_department = ${f.department}`);
  if (f.dimension) where.push(sql`eff.dimension = ${f.dimension}`);
  if (f.sentiment) where.push(sql`eff.sentiment = ${f.sentiment}`);
  if (f.theme) where.push(sql`${f.theme} = any(eff.themes)`);
  if (f.relationship) where.push(sql`r.relationship = ${f.relationship}`);
  if (scope.kind === "directReports") {
    where.push(
      sql`cp.snap_manager_person_id = ${scope.managerPersonId}::uuid`,
      sql`cp.reviewee_person_id <> ${scope.managerPersonId}::uuid`,
    );
  }
  return sql`${effectiveCte()},
    labeled as (
      select eff.*, ${analysisTextSql("a", "q")} as text, r.cycle_id,
             r.relationship::text as relationship,
             c.name as cycle_name, c.period_start::text as period_start,
             c.period_end::text as period_end,
             cp.id as participant_id, p.display_name as person_name,
             cp.snap_department as department
      from eff
      join answer a on a.id = eff.answer_id
      join question_revision q on q.id = a.question_revision_id
      join review_request r on r.id = a.request_id
      join cycle_participant cp on cp.id = r.participant_id
      join review_cycle c on c.id = r.cycle_id
      join person p on p.id = cp.reviewee_person_id
      where ${sql.join(where, sql` and `)}
    )`;
}

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

/** Most frequent themes, each with up to 3 pseudonymized example quotes. */
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
    t as (select unnest(themes) as theme, text, answer_id, participant_id, sentiment from labeled)
    select theme, count(*)::int as count, ${countCols}, count(*)::int as total,
           (array_agg(text order by length(text), answer_id))[1:3] as quotes
    from t group by theme ${minGroup(r.min)}
    order by count desc, theme limit ${limit}`);
  const sources = r.f.aggregateOnly ? null : await pseudonymSources(db);
  return rows.map((row) => ({
    theme: row.theme,
    count: row.count,
    sentiment: counts(row),
    quotes: sources ? pseudonymize(row.quotes, sources).texts : [],
  }));
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
      option: string;
      choices: { value: string; label: LocalizedText }[] | null;
    }
  >(sql`
    with ${labeledCtes(r)},
    ind as (
      -- One value per participant and indicator: the latest submitted
      -- manager review's answer (so each comment is counted once).
      select distinct on (r.participant_id, q.role)
             r.participant_id, r.cycle_id, q.role::text as role,
             a.option_label as option, q.choices
      from answer a
      join review_request r on r.id = a.request_id
      join question_revision q on q.id = a.question_revision_id
      where q.role::text in ('retention', 'engagement') and a.option_label is not null
        and r.relationship = 'manager' and r.status = 'submitted' and r.deleted_at is null
      order by r.participant_id, q.role, r.submitted_at desc nulls last, r.id
    )
    select ind.role, ind.option, (array_agg(ind.choices))[1] as choices,
           ${countCols}, count(*)::int as total
    from labeled l
    join ind on ind.participant_id = l.participant_id and ind.cycle_id = l.cycle_id
    group by 1, 2 ${minGroup(r.min, sql`l.participant_id`)} order by 1, 2`);
  return rows.map((r) => ({
    role: r.role,
    option: r.option,
    label: r.choices?.find((c) => c.value === r.option)?.label ?? null,
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
    confidence: number | null;
    source: string;
  }>(sql`
    with ${labeledCtes(r)}
    select answer_id, cycle_name, period_start, period_end, person_name,
           relationship, dimension, text, sentiment, themes, confidence, source
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
    confidence: r.confidence,
    source: r.source,
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
  const prompts = await db.execute<{ d: string; prompt: LocalizedText }>(sql`
    select distinct on (qa.dimension) qa.dimension as d, q.prompt
    from qualitative_analysis qa
    join answer a on a.id = qa.answer_id
    join question_revision q on q.id = a.question_revision_id
    join review_cycle c on c.id = q.cycle_id
    order by qa.dimension, c.period_end desc, q.sort, q.id`);
  return {
    dimensions: dims.map((r) => r.d),
    themes: [...new Set([...INITIAL_THEMES, ...themes.map((r) => r.t)])].sort(),
    departments: deps.map((r) => r.d),
    dimensionPrompts: Object.fromEntries(prompts.map((r) => [r.d, r.prompt])),
  };
}
