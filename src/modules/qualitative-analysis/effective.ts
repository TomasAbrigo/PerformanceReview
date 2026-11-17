import { sql } from "drizzle-orm";
import { analysisTextSql } from "./analysis-text";

/**
 * CTE `eff` ("v_effective_analysis"): per answer, the latest human correction
 * if any, else the latest machine/imported label. Columns: answer_id,
 * dimension, kind (of the question: text, rating, single_choice), sentiment,
 * themes, confidence (null when corrected), source (provider name, or
 * 'human'). A machine label whose analyzed text (the answer text, or the
 * label of a closed answer) changed since it was made (source_md5 differs) is
 * stale and left out; a human correction always counts.
 */
export const effectiveCte = () => sql`
  eff as (
    select qa.answer_id, qa.dimension, q.kind::text as kind,
           coalesce(c.new_sentiment, qa.sentiment) as sentiment,
           coalesce(c.new_themes, qa.themes) as themes,
           case when c.id is null then qa.confidence::float8 end as confidence,
           case when c.id is null then qa.provider else 'human' end as source
    from (
      select distinct on (x.answer_id) x.* from qualitative_analysis x
      order by x.answer_id, x.created_at desc, x.id
    ) qa
    join answer ans on ans.id = qa.answer_id
    join question_revision q on q.id = ans.question_revision_id
    left join lateral (
      select * from analysis_correction ac where ac.answer_id = qa.answer_id
      order by ac.created_at desc, ac.id desc limit 1
    ) c on true
    where c.id is not null or qa.source_md5 = md5(${analysisTextSql("ans", "q")})
  )`;
