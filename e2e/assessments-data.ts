import postgres from "postgres";
import { assertLocalDatabase } from "../src/db/local";
import { e2eDatabaseUrl } from "./database";

/** What the specs need to know of what the import left (read only). */
async function query<T extends object>(
  run: (sql: postgres.Sql) => Promise<T[]>,
): Promise<T[]> {
  const url = e2eDatabaseUrl();
  assertLocalDatabase(url);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

export type AssessmentSubject = {
  cycleId: string;
  cycleName: string;
  participantId: string;
  personId: string;
  personName: string;
  managerId: string | null;
  /** Titles of the goals the cycle's snapshot took for the person. */
  goalTitles: string[];
  /** Whether the manager review was shared with the person. */
  managerShared: boolean;
};

/**
 * Someone of the cycle of Bamboo's raw assessments report (the one with
 * answers on both sides: the closed manager questions, the custom ones) whose
 * name is unique, whose two reviews are submitted and that has goals in the
 * snapshot: what the Assessments specs open. Picks the one with the most
 * goals, then by name, so it is stable.
 */
export async function assessmentSubject(): Promise<AssessmentSubject> {
  const [row] = await query<
    Omit<AssessmentSubject, "goalTitles"> & { goalTitles: string[] | null }
  >(
    (sql) => sql`
      select c.id as "cycleId", c.name as "cycleName",
        cp.id as "participantId", p.id as "personId", p.display_name as "personName",
        cp.snap_manager_person_id as "managerId",
        (select array_agg(s.title order by s.title) from participant_goal_snapshot s
          where s.participant_id = cp.id and not s.no_longer_applicable) as "goalTitles",
        exists (select 1 from review_request m where m.participant_id = cp.id
          and m.relationship = 'manager' and m.shared_at is not null) as "managerShared"
      from cycle_participant cp
      join review_cycle c on c.id = cp.cycle_id and c.deleted_at is null
      join person p on p.id = cp.reviewee_person_id
      where cp.removed_at is null
        and (select count(*) from person p2 where p2.display_name = p.display_name) = 1
        and exists (
          select 1 from review_request r join answer a on a.request_id = r.id
          where r.participant_id = cp.id and r.relationship = 'self'
            and r.status = 'submitted' and r.deleted_at is null)
        and exists (
          select 1 from review_request r
          join answer a on a.request_id = r.id
          join question_revision q on q.id = a.question_revision_id
          where r.participant_id = cp.id and r.relationship = 'manager'
            and r.status = 'submitted' and r.deleted_at is null
            and q.role = 'retention')
        and exists (select 1 from participant_goal_snapshot s where s.participant_id = cp.id)
      order by (select count(*) from participant_goal_snapshot s where s.participant_id = cp.id) desc,
        p.display_name
      limit 1`,
  );
  if (!row)
    throw new Error(
      "the import left no participant with both reviews answered and goals",
    );
  return { ...row, goalTitles: row.goalTitles ?? [] };
}

/**
 * A participant of the same cycle who is neither `personId` nor managed by or
 * the manager `managerId`: someone the subject (as an employee) and their
 * manager may not open.
 */
export async function otherParticipant(
  cycleId: string,
  personId: string,
  managerId: string | null,
): Promise<{ participantId: string; personName: string }> {
  const [row] = await query<{ participantId: string; personName: string }>(
    (sql) => sql`
      select cp.id as "participantId", p.display_name as "personName"
      from cycle_participant cp join person p on p.id = cp.reviewee_person_id
      where cp.cycle_id = ${cycleId} and cp.removed_at is null
        and cp.reviewee_person_id <> ${personId}
        and cp.snap_manager_person_id is distinct from ${managerId}
        and cp.reviewee_person_id is distinct from ${managerId}
      order by p.display_name limit 1`,
  );
  return row;
}

export type GoalSubject = {
  goalId: string;
  title: string;
  personId: string;
  personName: string;
  milestones: number;
};

/** A live goal of `personId` (the one with the most milestones, then by title). */
export async function goalOf(personId: string): Promise<GoalSubject> {
  const [row] = await query<GoalSubject>(
    (sql) => sql`
      select g.id as "goalId", g.title, g.person_id as "personId",
        p.display_name as "personName",
        (select count(*)::int from goal_milestone m where m.goal_id = g.id and m.deleted_at is null) as milestones
      from goal g join person p on p.id = g.person_id
      where g.person_id = ${personId} and g.deleted_at is null
      order by milestones desc, g.title limit 1`,
  );
  return row;
}

/** A live goal that does not belong to `personId`. */
export async function goalOfSomeoneElse(
  personId: string,
): Promise<GoalSubject> {
  const [row] = await query<GoalSubject>(
    (sql) => sql`
      select g.id as "goalId", g.title, g.person_id as "personId",
        p.display_name as "personName", 0 as milestones
      from goal g join person p on p.id = g.person_id
      where g.person_id <> ${personId} and g.deleted_at is null
      order by g.title, g.id limit 1`,
  );
  return row;
}

/** How many live goals `personId` owns. */
export async function goalCount(personId: string): Promise<number> {
  const [row] = await query<{ n: number }>(
    (sql) => sql`select count(*)::int as n from goal
      where person_id = ${personId} and deleted_at is null`,
  );
  return row.n;
}

/** How many live goals are in the snapshot of the cycle (the Goals list filtered by that cycle). */
export async function cycleGoalCount(cycleId: string): Promise<number> {
  const [row] = await query<{ n: number }>(
    (sql) => sql`
      select count(distinct s.goal_id)::int as n
      from participant_goal_snapshot s
      join cycle_participant cp on cp.id = s.participant_id and cp.removed_at is null
      join goal g on g.id = s.goal_id and g.deleted_at is null
      where cp.cycle_id = ${cycleId} and not s.no_longer_applicable`,
  );
  return row.n;
}

/** Overall: how many live goals exist. */
export async function allGoalCount(): Promise<number> {
  const [row] = await query<{ n: number }>(
    (sql) => sql`select count(*)::int as n from goal where deleted_at is null`,
  );
  return row.n;
}
