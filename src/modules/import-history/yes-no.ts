import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { YES_NO_START_SQL } from "@/modules/qualitative-analysis/analysis-text";

/** Share of the non-empty answers that must start with a yes/no token. */
export const YES_NO_SHARE = 0.9;
/** Fewer non-empty answers than this never decide anything. */
export const YES_NO_MIN_ANSWERS = 3;

/**
 * Marks (or unmarks) as yes/no the imported custom text questions of the
 * given cycles (or all), from their data (#128): a question is yes/no when at
 * least YES_NO_SHARE of its non-empty answers start with a yes/no token
 * ("Sí", "Si,", "Yes", "No por ahora."…), with at least YES_NO_MIN_ANSWERS
 * of them. Bamboo's custom questions are free text, so the import cannot
 * know it from the header; like reapplyLikertMappings, it is decided by
 * column once the whole file is in. Template questions (question_id set)
 * keep what the template says. Returns how many revisions changed.
 */
export async function markYesNoQuestions(
  db: DbOrTx,
  { cycleIds }: { cycleIds?: string[] } = {},
): Promise<number> {
  if (cycleIds && cycleIds.length === 0) return 0;
  const rows = await db.execute<{ id: string }>(sql`
    with stats as (
      select q.id,
             count(*) filter (where btrim(coalesce(a.text_value, '')) <> '') as answered,
             count(*) filter (where a.text_value ~ ${YES_NO_START_SQL}) as yes_no
      from question_revision q
      left join answer a on a.question_revision_id = q.id
      where q.kind = 'text' and q.question_id is null
        and q.dimension like 'custom\\_%'
        ${
          cycleIds
            ? sql`and q.cycle_id in (${sql.join(
                cycleIds.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`
            : sql``
        }
      group by q.id
    )
    update question_revision q
    set yes_no = (s.answered >= ${YES_NO_MIN_ANSWERS}::int
                  and s.yes_no >= ${YES_NO_SHARE}::numeric * s.answered)
    from stats s
    where s.id = q.id
      and q.yes_no is distinct from (s.answered >= ${YES_NO_MIN_ANSWERS}::int
                  and s.yes_no >= ${YES_NO_SHARE}::numeric * s.answered)
    returning q.id`);
  return rows.length;
}
