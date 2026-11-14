import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { goalStatuses, type GoalStatus } from "@/db/schema";
import { rowsOf } from "@/lib/sql";
import { isUuid } from "@/lib/uuid";
import { encodeCursor, pageOf, type Page } from "../pagination";
import {
  afterTsId,
  and,
  currentJobJoin,
  identityCtes,
  iso,
  personRef,
  type PersonRef,
} from "./shared";

export { goalStatuses };

export type MilestoneRow = {
  id: string;
  sourceSystem: string;
  sourceId: string | null;
  title: string;
  position: number;
  completedAt: string | null;
  lastUpdateAt: string | null;
};

export type GoalRow = {
  id: string;
  sourceSystem: string;
  sourceId: string | null;
  /** The owner. */
  person: PersonRef;
  employeeNumber: string | null;
  /** The owner's manager and org data today (for exports; not part of the goal). */
  manager: PersonRef | null;
  department: string | null;
  division: string | null;
  jobTitle: string | null;
  location: string | null;
  title: string;
  description: string | null;
  percentComplete: number;
  status: GoalStatus;
  dueDate: string | null;
  completionDate: string | null;
  lastChangedAt: string | null;
  alignsWithSourceId: string | null;
  commentCount: number;
  milestones: MilestoneRow[];
  sharedWith: PersonRef[];
  createdAt: string;
  updatedAt: string;
};

export type ListGoalsInput = {
  limit: number;
  cursor?: string | null;
  personId?: string;
  status?: GoalStatus;
  /** Owners whose manager today is this person. */
  managerId?: string;
};

type Raw = Omit<GoalRow, "person" | "manager" | "milestones" | "sharedWith"> & {
  personId: string;
  personSystem: string | null;
  personBambooId: string | null;
  personName: string;
  managerId: string | null;
  managerSystem: string | null;
  managerBambooId: string | null;
  managerName: string | null;
};

const uuidList = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/** Goals (never the deleted ones), oldest first by (created_at, id), with milestones and sharing. */
export async function listGoalRows(
  db: DbOrTx,
  { limit, cursor, personId, status, managerId }: ListGoalsInput,
): Promise<Page<GoalRow>> {
  // An id that cannot exist matches nothing (and must not reach a uuid cast).
  if ((personId && !isUuid(personId)) || (managerId && !isUuid(managerId))) {
    return { items: [], nextCursor: null };
  }
  const raw = rowsOf<Raw>(
    await db.execute(sql`
      with ${identityCtes}
      select g.id, g.source_system as "sourceSystem", g.source_id as "sourceId",
        g.person_id as "personId", p.display_name as "personName",
        bi.source_system as "personSystem", bi.value as "personBambooId",
        en.value as "employeeNumber",
        j.manager_person_id as "managerId",
        mbi.source_system as "managerSystem", mbi.value as "managerBambooId",
        mp.display_name as "managerName",
        j.department, j.division, j.job_title as "jobTitle", j.location,
        g.title, g.description, g.percent_complete as "percentComplete",
        g.status::text as status, g.due_date::text as "dueDate",
        g.completion_date::text as "completionDate",
        ${iso("g.last_changed_at")} as "lastChangedAt",
        g.aligns_with_source_id as "alignsWithSourceId",
        g.comment_count as "commentCount",
        ${iso("g.created_at")} as "createdAt", ${iso("g.updated_at")} as "updatedAt"
      from goal g
      join person p on p.id = g.person_id
      left join bamboo_identity bi on bi.person_id = g.person_id
      left join employee_number en on en.person_id = g.person_id
      ${currentJobJoin("g.person_id")}
      left join person mp on mp.id = j.manager_person_id
      left join bamboo_identity mbi on mbi.person_id = j.manager_person_id
      where ${and([
        sql`g.deleted_at is null`,
        afterTsId("g.created_at", "g.id", cursor),
        personId ? sql`g.person_id = ${personId}::uuid` : undefined,
        status ? sql`g.status = ${status}::goal_status` : undefined,
        managerId ? sql`j.manager_person_id = ${managerId}::uuid` : undefined,
      ])}
      order by g.created_at, g.id
      limit ${limit + 1}
    `),
  );
  const page = pageOf(raw, limit, (r) => encodeCursor([r.createdAt, r.id]));
  const ids = page.items.map((g) => g.id);

  const milestones = ids.length
    ? rowsOf<MilestoneRow & { goalId: string }>(
        await db.execute(sql`
          select m.id, m.goal_id as "goalId", m.source_system as "sourceSystem",
            m.source_id as "sourceId", m.title, m.position,
            ${iso("m.completed_at")} as "completedAt",
            ${iso("m.last_update_at")} as "lastUpdateAt"
          from goal_milestone m
          where m.goal_id in (${uuidList(ids)}) and m.deleted_at is null
          order by m.position, m.id
        `),
      )
    : [];
  const shares = ids.length
    ? rowsOf<{
        goalId: string;
        id: string;
        system: string | null;
        bambooId: string | null;
        name: string;
      }>(
        await db.execute(sql`
          with ${identityCtes}
          select s.goal_id as "goalId", p.id, bi.source_system as system,
            bi.value as "bambooId", p.display_name as name
          from goal_share s
          join person p on p.id = s.person_id
          left join bamboo_identity bi on bi.person_id = p.id
          where s.goal_id in (${uuidList(ids)})
          order by p.display_name, p.id
        `),
      )
    : [];

  return {
    nextCursor: page.nextCursor,
    items: page.items.map(
      ({
        personId: ownerId,
        personSystem,
        personBambooId,
        personName,
        managerId: mId,
        managerSystem,
        managerBambooId,
        managerName,
        ...goal
      }) => ({
        ...goal,
        person: personRef(ownerId, personSystem, personBambooId, personName)!,
        manager: personRef(mId, managerSystem, managerBambooId, managerName),
        milestones: milestones
          .filter((m) => m.goalId === goal.id)
          .map((m) => ({
            id: m.id,
            sourceSystem: m.sourceSystem,
            sourceId: m.sourceId,
            title: m.title,
            position: m.position,
            completedAt: m.completedAt,
            lastUpdateAt: m.lastUpdateAt,
          })),
        sharedWith: shares
          .filter((s) => s.goalId === goal.id)
          .map((s) => personRef(s.id, s.system, s.bambooId, s.name)!),
      }),
    ),
  };
}
