import postgres from "postgres";
import { assertLocalDatabase } from "../src/db/local";
import { e2eDatabaseUrl } from "./database";

/**
 * Makes sure the imported cycles carry retention and engagement as the
 * indicators read them: answers of the manager's review to question revisions
 * with the role `retention` / `engagement`, Likert 1-5.
 *
 * The Santex template import (#57) leaves exactly that. Until it is in, the
 * Employee Performance import keeps the manager's two closed questions as
 * lettered single choices without a role: this derives the roles and the 1-5
 * values from them (A = 5 ... E = 1, the documented default equivalence).
 * With the import doing it, this finds the answers and changes nothing.
 */
export async function ensureIndicatorAnswers(): Promise<void> {
  const url = e2eDatabaseUrl();
  assertLocalDatabase(url);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [found] = await sql<{ n: number }[]>`
      select count(*)::int as n
      from answer a join question_revision q on q.id = a.question_revision_id
      where q.role in ('retention', 'engagement')
        and a.option_value between 1 and 5`;
    if (found.n > 0) return;
    await sql`
      update question_revision set role = 'retention'
      where role is null and 'manager' = any(applies_to)
        and prompt->>'en' ilike '%job offer%'`;
    await sql`
      update question_revision set role = 'engagement'
      where role is null and 'manager' = any(applies_to)
        and prompt->>'en' ilike '%engaged%'`;
    await sql`
      update answer a
      set option_value = 6 - (ascii(upper(a.option_label)) - 64),
          normalized = (5 - (ascii(upper(a.option_label)) - 64)) / 4.0
      from question_revision q
      where q.id = a.question_revision_id
        and q.role in ('retention', 'engagement')
        and a.option_label ~* '^[A-E]$'`;
  } finally {
    await sql.end();
  }
}

/**
 * A person who is the manager of the snapshot of someone with indicators in
 * `cycleName`, with a name no other person shares (the actor selector picks
 * people by name).
 */
export async function snapshotManagerWithIndicators(
  cycleName: string,
): Promise<{ name: string; reports: number }> {
  const url = e2eDatabaseUrl();
  assertLocalDatabase(url);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql<{ name: string; reports: number }[]>`
      select m.display_name as name, count(distinct cp.id)::int as reports
      from cycle_participant cp
      join review_cycle c on c.id = cp.cycle_id and c.name = ${cycleName}
      join person m on m.id = cp.snap_manager_person_id
      join review_request r on r.participant_id = cp.id
        and r.relationship = 'manager' and r.status = 'submitted'
      join answer a on a.request_id = r.id
      join question_revision q on q.id = a.question_revision_id
        and q.role in ('retention', 'engagement')
      where cp.removed_at is null and a.option_value between 1 and 5
        and (select count(*) from person p where p.display_name = m.display_name) = 1
      group by m.display_name
      order by reports desc, m.display_name
      limit 1`;
    if (!rows[0]) throw new Error("no snapshot manager with indicators");
    return rows[0];
  } finally {
    await sql.end();
  }
}
