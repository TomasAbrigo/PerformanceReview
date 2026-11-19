import { sql } from "drizzle-orm";
import { analysisTextSql } from "./analysis-text";
import { DEMO_PROVIDERS, IMPORT_PROVIDER } from "./constants";

/**
 * CTE `eff` ("v_effective_analysis"), the effective reading of each answer
 * with free text (#128). Public contract of the screens (#129).
 *
 * Precedence, latest of each: a human correction > an imported label > a
 * machine label. Only labels made from the answer's current text compete
 * (source_md5 = md5 of analysisTextSql: a label of an older text, or of a
 * chosen option, which is never read any more, is stale); a human correction
 * counts even when its label went stale.
 *
 * Columns:
 * - answer_id, dimension, kind (of the question: text, rating,
 *   single_choice), yes_no_question (question_revision.yes_no).
 * - sentiment (sentiment enum), substance ('none'|'generic'|'specific', null
 *   for an imported or pre-#128 label not corrected), themes text[], signals
 *   text[] (keys of `signals`).
 * - confidence: float8, null when corrected or not estimated (mock, import
 *   without one).
 * - origin: 'human' | 'import' | 'machine' (LabelOrigin).
 * - provider: the provider of the label ('mock', 'anthropic', 'import'), or
 *   'human' for a correction; model: the model of its run (null for a
 *   correction, an import or the mock); prompt_version (null when human).
 * - demo: the label is a demo heuristic (DEMO_PROVIDERS), not an analysis.
 * - source: same as provider (kept for the existing readers).
 */
export const effectiveCte = () => sql`
  eff as (
    select l.answer_id, l.dimension, l.kind, l.yes_no_question,
           coalesce(c.new_sentiment, l.sentiment) as sentiment,
           coalesce(c.new_substance, l.substance) as substance,
           coalesce(c.new_themes, l.themes) as themes,
           coalesce(c.new_signals, l.signals) as signals,
           case when c.id is null then l.confidence::float8 end as confidence,
           case when c.id is not null then 'human'
                when l.provider = ${IMPORT_PROVIDER} then 'import'
                else 'machine' end as origin,
           case when c.id is null then l.provider else 'human' end as provider,
           case when c.id is null then run.model end as model,
           case when c.id is null then l.prompt_version end as prompt_version,
           (c.id is null and l.provider in (${sql.join(
             DEMO_PROVIDERS.map((p) => sql`${p}`),
             sql`, `,
           )})) as demo,
           case when c.id is null then l.provider else 'human' end as source
    from (
      select distinct on (x.answer_id) x.*, q.kind::text as kind,
             q.yes_no as yes_no_question,
             x.source_md5 = md5(${analysisTextSql("ans", "q")}) as fresh
      from qualitative_analysis x
      join answer ans on ans.id = x.answer_id
      join question_revision q on q.id = ans.question_revision_id
      where ${analysisTextSql("ans", "q")} is not null
      order by x.answer_id,
               (x.source_md5 = md5(${analysisTextSql("ans", "q")})) desc,
               (x.provider = ${IMPORT_PROVIDER}) desc,
               x.created_at desc, x.id
    ) l
    left join analysis_run run on run.id = l.run_id
    left join lateral (
      select * from analysis_correction ac where ac.answer_id = l.answer_id
      order by ac.created_at desc, ac.id desc limit 1
    ) c on true
    where c.id is not null or l.fresh
  )`;
