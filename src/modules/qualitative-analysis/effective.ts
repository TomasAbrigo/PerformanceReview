import { sql } from "drizzle-orm";

/**
 * CTE `eff` ("v_effective_analysis"): per answer, the latest human correction
 * if any, else the latest machine/imported label. Columns: answer_id,
 * dimension, sentiment, themes, confidence (null when corrected), source
 * (provider name, or 'human').
 */
export const effectiveCte = () => sql`
  eff as (
    select qa.answer_id, qa.dimension,
           coalesce(c.new_sentiment, qa.sentiment) as sentiment,
           coalesce(c.new_themes, qa.themes) as themes,
           case when c.id is null then qa.confidence::float8 end as confidence,
           case when c.id is null then qa.provider else 'human' end as source
    from (
      select distinct on (answer_id) * from qualitative_analysis
      order by answer_id, created_at desc, id
    ) qa
    left join lateral (
      select * from analysis_correction ac where ac.answer_id = qa.answer_id
      order by ac.created_at desc, ac.id desc limit 1
    ) c on true
  )`;
