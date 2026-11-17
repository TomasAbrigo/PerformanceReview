import { type SQL, sql } from "drizzle-orm";

/**
 * SQL expression: the text the qualitative analysis labels for answer `a` of
 * question revision `q` (aliases of the surrounding query), null when there
 * is nothing to label.
 *
 * - Open question: the answer text (as is: its md5 keys the stale check).
 * - Closed question (rating, single choice): the text typed next to the
 *   option when there is one ("Other" + text), else the label of the chosen
 *   option (es), else the stored option itself.
 */
export function analysisTextSql(a = "a", q = "q"): SQL {
  const A = sql.raw(a);
  const Q = sql.raw(q);
  const typed = sql`case when btrim(${A}.text_value) <> '' then ${A}.text_value end`;
  return sql`(case when ${Q}.kind = 'text' then ${typed}
    else coalesce(${typed},
      (select ch->'label'->>'es' from jsonb_array_elements(${Q}.choices) ch
        where ch->>'value' = ${A}.option_label limit 1),
      nullif(btrim(${A}.option_label), '')) end)`;
}

/**
 * SQL predicate: the answer is analyzable: it has text to label and it is an
 * open question, or a closed one that belongs to a dimension (the analysis of
 * closed questions is on, see the `analysis.includeClosed` setting).
 */
export function analyzableSql(includeClosed: boolean, a = "a", q = "q"): SQL {
  const Q = sql.raw(q);
  return sql`(${analysisTextSql(a, q)} is not null and (${Q}.kind = 'text'${
    includeClosed ? sql` or ${Q}.dimension is not null` : sql``
  }))`;
}
