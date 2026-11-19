import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/** Empties what the qualitative DB tests touch. */
export async function resetQualitative(): Promise<void> {
  await db.execute(
    sql`TRUNCATE analysis_correction, qualitative_analysis, analysis_run, theme, admin_audit_log, review_cycle, source_identity, employment, person CASCADE`,
  );
}

export async function insertPerson(
  name: string,
  opts: { email?: string; employeeNumber?: string } = {},
): Promise<string> {
  const [p] = await db.execute<{ id: string }>(
    sql`insert into person (display_name, work_email) values (${name}, ${opts.email ?? null}) returning id`,
  );
  if (opts.employeeNumber) {
    await db.execute(sql`
      insert into source_identity (person_id, source_system, kind, value)
      values (${p.id}::uuid, 'bamboo_api', 'employee_number', ${opts.employeeNumber})`);
  }
  return p.id;
}

export async function insertCycle(
  name: string,
  periodEnd: string,
): Promise<string> {
  const [c] = await db.execute<{ id: string }>(sql`
    insert into review_cycle (name, period_start, period_end, snapshot_date, status, components, anonymity)
    values (${name}, ${periodEnd}::date - 365, ${periodEnd}::date, ${periodEnd}::date, 'sharing',
      ${JSON.stringify({ self: true, manager: true, peer: false, upward: false, calibration: false })}::jsonb,
      ${JSON.stringify({ peer: "transparent", upward: "transparent" })}::jsonb)
    returning id`);
  return c.id;
}

export async function insertQuestion(
  cycleId: string,
  prompt: string,
  opts: {
    kind?: "text" | "single_choice";
    role?: string;
    /** question_revision.dimension (the import mapping sets it). */
    dimension?: string;
    choices?: { value: string; label: { es: string; en: string } }[];
    /** question_revision.yes_no: a yes/no question (#128). */
    yesNo?: boolean;
  } = {},
): Promise<string> {
  const [q] = await db.execute<{ id: string }>(sql`
    insert into question_revision (cycle_id, section_title, prompt, kind, applies_to, visible_to_reviewee, required, sort, role, choices, dimension, yes_no)
    values (${cycleId}::uuid, ${JSON.stringify({ es: "S", en: "S" })}::jsonb,
      ${JSON.stringify({ es: prompt, en: prompt })}::jsonb, ${opts.kind ?? "text"},
      array['self','manager'], true, false, 0, ${opts.role ?? null},
      ${
        opts.kind === "single_choice"
          ? JSON.stringify(
              opts.choices ?? [
                { value: "A", label: { es: "A", en: "A" } },
                { value: "B", label: { es: "B", en: "B" } },
              ],
            )
          : null
      }::jsonb, ${opts.dimension ?? null}, ${opts.yesNo ?? false})
    returning id`);
  return q.id;
}

export async function insertParticipant(
  cycleId: string,
  personId: string,
  managerId: string | null,
  department = "Ingeniería",
): Promise<string> {
  const [cp] = await db.execute<{ id: string }>(sql`
    insert into cycle_participant (cycle_id, reviewee_person_id, snapshot_as_of, snap_manager_person_id, snap_department)
    values (${cycleId}::uuid, ${personId}::uuid, current_date, ${managerId}::uuid, ${department})
    returning id`);
  return cp.id;
}

/** A submitted request with one answer per question (text or option). */
export async function insertAnswer(
  cycleId: string,
  participantId: string,
  reviewerId: string | null,
  relationship: "self" | "manager",
  answers: {
    questionId: string;
    text?: string;
    option?: string;
    /** The option's 1-5 value (the indicator questions). */
    value?: number;
  }[],
): Promise<string[]> {
  const [r] = await db.execute<{ id: string }>(sql`
    insert into review_request (cycle_id, participant_id, reviewer_person_id, relationship, status, submitted_at)
    values (${cycleId}::uuid, ${participantId}::uuid, ${reviewerId}::uuid, ${relationship}, 'submitted', now())
    on conflict on constraint review_request_participant_rel_reviewer_uq do update set status = 'submitted'
    returning id`);
  const ids: string[] = [];
  for (const a of answers) {
    const [row] = await db.execute<{ id: string }>(sql`
      insert into answer (request_id, question_revision_id, text_value, option_label, option_value)
      values (${r.id}::uuid, ${a.questionId}::uuid, ${a.text ?? null}, ${a.option ?? null}, ${a.value ?? null})
      returning id`);
    ids.push(row.id);
  }
  return ids;
}
