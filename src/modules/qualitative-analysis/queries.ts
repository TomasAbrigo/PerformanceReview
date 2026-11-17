import { type SQL, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { LocalizedText } from "@/db/schema/rating-scales";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { sentiments, type Sentiment } from "./constants";
import { effectiveCte } from "./effective";
import { AnalysisError } from "./errors";
import { pseudonymize } from "./pseudonymize";
import { pseudonymSources } from "./service";
import type {
  CommentRow,
  DimensionSentiment,
  IndicatorSentiment,
  QualitativeFilters,
  SentimentCounts,
  ThemeRank,
  TrendPoint,
} from "./types";

/**
 * Who sees what: HR every label; a manager the labels about their direct
 * reports at the cycle snapshot; an employee nothing (never their own labels).
 * aggregateOnly (leadership) keeps counts and drops comments and quotes.
 */
const canSee = (a: ActorContext) =>
  a.role === "hr" || (a.role === "manager" && a.personId !== null);

/** CTEs eff + labeled: effective labels of submitted answers in scope. */
function labeledCtes(actor: ActorContext, f: QualitativeFilters): SQL {
  const where: SQL[] = [sql`r.deleted_at is null`, sql`cp.removed_at is null`];
  if (f.cycleId) {
    if (!isUuid(f.cycleId)) throw new AnalysisError("not_found");
    where.push(sql`r.cycle_id = ${f.cycleId}::uuid`);
  }
  if (f.department) where.push(sql`cp.snap_department = ${f.department}`);
  if (f.dimension) where.push(sql`eff.dimension = ${f.dimension}`);
  if (f.sentiment) where.push(sql`eff.sentiment = ${f.sentiment}`);
  if (f.theme) where.push(sql`${f.theme} = any(eff.themes)`);
  if (actor.role !== "hr") {
    where.push(sql`cp.snap_manager_person_id = ${actor.personId}::uuid`);
  }
  return sql`${effectiveCte()},
    labeled as (
      select eff.*, a.text_value as text, r.cycle_id, r.relationship::text as relationship,
             c.name as cycle_name, c.period_end::text as period_end,
             cp.id as participant_id, p.display_name as person_name,
             cp.snap_department as department
      from eff
      join answer a on a.id = eff.answer_id
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
const counts = (
  r: Record<Sentiment, number> & { total: number },
): SentimentCounts => ({
  positive: r.positive,
  constructive: r.constructive,
  negative: r.negative,
  total: r.total,
});

/** Sentiment counts per dimension (stacked bars). */
export async function sentimentByDimension(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<DimensionSentiment[]> {
  if (!canSee(actor)) return [];
  const rows = await db.execute<SentimentCounts & { dimension: string }>(sql`
    with ${labeledCtes(actor, f)}
    select dimension, ${countCols}, count(*)::int as total
    from labeled group by dimension order by dimension`);
  return rows.map((r) => ({ dimension: r.dimension, ...counts(r) }));
}

/** Sentiment counts per cycle, ordered by period (all cycles). */
export async function sentimentTrend(
  db: DbOrTx,
  actor: ActorContext,
  f: Omit<QualitativeFilters, "cycleId">,
): Promise<TrendPoint[]> {
  if (!canSee(actor)) return [];
  const rows = await db.execute<
    SentimentCounts & {
      cycle_id: string;
      cycle_name: string;
      period_end: string;
    }
  >(sql`
    with ${labeledCtes(actor, { ...f, cycleId: undefined })}
    select cycle_id, cycle_name, period_end, ${countCols}, count(*)::int as total
    from labeled group by 1, 2, 3 order by period_end, cycle_name`);
  return rows.map((r) => ({
    cycleId: r.cycle_id,
    cycleName: r.cycle_name,
    periodEnd: r.period_end,
    ...counts(r),
  }));
}

/** Most frequent themes, each with up to 3 pseudonymized example quotes. */
export async function topThemes(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
  limit = 10,
): Promise<ThemeRank[]> {
  if (!canSee(actor)) return [];
  const rows = await db.execute<{
    theme: string;
    count: number;
    quotes: string[];
  }>(sql`
    with ${labeledCtes(actor, f)},
    t as (select unnest(themes) as theme, text, answer_id from labeled)
    select theme, count(*)::int as count,
           (array_agg(text order by length(text), answer_id))[1:3] as quotes
    from t group by theme order by count desc, theme limit ${limit}`);
  if (f.aggregateOnly) return rows.map((r) => ({ ...r, quotes: [] }));
  const sources = await pseudonymSources(db);
  return rows.map((r) => ({
    theme: r.theme,
    count: r.count,
    quotes: pseudonymize(r.quotes, sources).texts,
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
  if (!canSee(actor)) return [];
  const rows = await db.execute<
    SentimentCounts & {
      role: string;
      option: string;
      choices: { value: string; label: LocalizedText }[] | null;
    }
  >(sql`
    with ${labeledCtes(actor, f)},
    ind as (
      select r.participant_id, r.cycle_id, q.role::text as role, a.option_label as option,
             q.choices
      from answer a
      join review_request r on r.id = a.request_id and r.deleted_at is null
      join question_revision q on q.id = a.question_revision_id
      where q.role::text in ('retention', 'engagement') and a.option_label is not null
    )
    select ind.role, ind.option, (array_agg(ind.choices))[1] as choices,
           ${countCols}, count(*)::int as total
    from labeled l
    join ind on ind.participant_id = l.participant_id and ind.cycle_id = l.cycle_id
    group by 1, 2 order by 1, 2`);
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
  if (!canSee(actor) || f.aggregateOnly) return [];
  const rows = await db.execute<{
    answer_id: string;
    cycle_name: string;
    person_name: string;
    relationship: string;
    dimension: string;
    text: string;
    sentiment: Sentiment;
    themes: string[];
    confidence: number | null;
    source: string;
  }>(sql`
    with ${labeledCtes(actor, f)}
    select answer_id, cycle_name, person_name, relationship, dimension, text,
           sentiment, themes, confidence, source
    from labeled order by period_end desc, person_name, dimension, answer_id
    limit ${limit}`);
  return rows.map((r) => ({
    answerId: r.answer_id,
    cycleName: r.cycle_name,
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

/** Dimensions and themes present, for the filters. */
export async function qualitativeFilterOptions(
  db: DbOrTx,
): Promise<{ dimensions: string[]; themes: string[]; departments: string[] }> {
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
    themes: themes.map((r) => r.t),
    departments: deps.map((r) => r.d),
  };
}
