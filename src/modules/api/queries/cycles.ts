import { sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type {
  CycleAnonymity,
  CycleComponents,
  CycleDueDates,
  CycleStatus,
  ScheduleKind,
} from "@/modules/review-core/status";
import type { ParticipantFilter } from "@/db/schema";
import { rowsOf } from "@/lib/sql";
import { isUuid } from "@/lib/uuid";
import { encodeCursor, pageOf, type Page } from "../pagination";
import {
  afterTsId,
  and,
  identityCtes,
  iso,
  personRef,
  type PersonRef,
} from "./shared";

export type CycleRow = {
  id: string;
  sourceSystem: string;
  sourceId: string | null;
  name: string;
  description: string | null;
  periodStart: string;
  periodEnd: string;
  snapshotDate: string;
  status: CycleStatus;
  components: CycleComponents;
  anonymity: CycleAnonymity;
  templateId: string | null;
  finalScaleId: string | null;
  dueDates: CycleDueDates;
  scheduleKind: ScheduleKind;
  participantFilter: ParticipantFilter;
  launchedAt: string | null;
  /** Participants not removed. */
  participantCount: number;
  createdAt: string;
  updatedAt: string;
};

const CYCLE_COLUMNS = sql`
  c.id, c.source_system as "sourceSystem", c.source_id as "sourceId", c.name,
  c.description, c.period_start::text as "periodStart",
  c.period_end::text as "periodEnd", c.snapshot_date::text as "snapshotDate",
  c.status::text as status, c.components, c.anonymity,
  c.template_id as "templateId", c.final_scale_id as "finalScaleId",
  c.due_dates as "dueDates", c.schedule_kind::text as "scheduleKind",
  c.participant_filter as "participantFilter",
  ${iso("c.launched_at")} as "launchedAt",
  (select count(*)::int from cycle_participant cp
    where cp.cycle_id = c.id and cp.removed_at is null) as "participantCount",
  ${iso("c.created_at")} as "createdAt", ${iso("c.updated_at")} as "updatedAt"
`;

/** Cycles (not deleted), oldest first by (created_at, id). */
export async function listCycleRows(
  db: DbOrTx,
  { limit, cursor }: { limit: number; cursor?: string | null },
): Promise<Page<CycleRow>> {
  const rows = rowsOf<CycleRow>(
    await db.execute(sql`
      select ${CYCLE_COLUMNS}
      from review_cycle c
      where ${and([sql`c.deleted_at is null`, afterTsId("c.created_at", "c.id", cursor)])}
      order by c.created_at, c.id
      limit ${limit + 1}
    `),
  );
  return pageOf(rows, limit, (r) => encodeCursor([r.createdAt, r.id]));
}

export type ParticipantRow = {
  /** cycle_participant id. */
  id: string;
  cycleId: string;
  cycleName: string;
  cycleSourceId: string | null;
  /** The reviewee. */
  person: PersonRef;
  employeeNumber: string | null;
  /** The org data frozen at `snapshotAsOf`. */
  snapshotAsOf: string;
  snapManager: PersonRef | null;
  snapDepartment: string | null;
  snapDivision: string | null;
  snapJobTitle: string | null;
  snapLocation: string | null;
  snapJobHistoryId: string | null;
  addedAt: string;
  removedAt: string | null;
};

type RawParticipant = Omit<ParticipantRow, "person" | "snapManager"> & {
  personId: string;
  personSystem: string | null;
  personBambooId: string | null;
  personName: string;
  managerId: string | null;
  managerSystem: string | null;
  managerBambooId: string | null;
  managerName: string | null;
};

async function selectParticipants(
  db: DbOrTx,
  where: SQL,
  order: SQL,
  limit?: number,
): Promise<ParticipantRow[]> {
  const raw = rowsOf<RawParticipant>(
    await db.execute(sql`
      with ${identityCtes}
      select cp.id, cp.cycle_id as "cycleId", c.name as "cycleName",
        c.source_id as "cycleSourceId",
        cp.reviewee_person_id as "personId", p.display_name as "personName",
        bi.source_system as "personSystem", bi.value as "personBambooId",
        en.value as "employeeNumber",
        cp.snapshot_as_of::text as "snapshotAsOf",
        cp.snap_manager_person_id as "managerId",
        mbi.source_system as "managerSystem", mbi.value as "managerBambooId",
        mp.display_name as "managerName",
        cp.snap_department as "snapDepartment", cp.snap_division as "snapDivision",
        cp.snap_job_title as "snapJobTitle", cp.snap_location as "snapLocation",
        cp.snap_job_history_id as "snapJobHistoryId",
        ${iso("cp.added_at")} as "addedAt", ${iso("cp.removed_at")} as "removedAt"
      from cycle_participant cp
      join review_cycle c on c.id = cp.cycle_id and c.deleted_at is null
      join person p on p.id = cp.reviewee_person_id
      left join bamboo_identity bi on bi.person_id = cp.reviewee_person_id
      left join employee_number en on en.person_id = cp.reviewee_person_id
      left join person mp on mp.id = cp.snap_manager_person_id
      left join bamboo_identity mbi on mbi.person_id = cp.snap_manager_person_id
      where ${where}
      order by ${order}
      ${limit === undefined ? sql`` : sql`limit ${limit}`}
    `),
  );
  return raw.map(
    ({
      personId,
      personSystem,
      personBambooId,
      personName,
      managerId,
      managerSystem,
      managerBambooId,
      managerName,
      ...row
    }) => ({
      ...row,
      person: personRef(personId, personSystem, personBambooId, personName)!,
      snapManager: personRef(
        managerId,
        managerSystem,
        managerBambooId,
        managerName,
      ),
    }),
  );
}

/** Participants of every cycle (or one), oldest first by (added_at, id). */
export async function listParticipantRows(
  db: DbOrTx,
  {
    limit,
    cursor,
    cycleId,
  }: { limit: number; cursor?: string | null; cycleId?: string },
): Promise<Page<ParticipantRow>> {
  if (cycleId && !isUuid(cycleId)) return { items: [], nextCursor: null };
  const rows = await selectParticipants(
    db,
    and([
      sql`true`,
      afterTsId("cp.added_at", "cp.id", cursor),
      cycleId ? sql`cp.cycle_id = ${cycleId}::uuid` : undefined,
    ]),
    sql`cp.added_at, cp.id`,
    limit + 1,
  );
  return pageOf(rows, limit, (r) => encodeCursor([r.addedAt, r.id]));
}

export type CycleDetail = CycleRow & {
  questionCount: number;
  participants: ParticipantRow[];
};

/** A cycle with every participant (removed ones too) and their snapshots; null if unknown. */
export async function getCycleDetail(
  db: DbOrTx,
  id: string,
): Promise<CycleDetail | null> {
  if (!isUuid(id)) return null;
  const [cycle] = rowsOf<CycleRow & { questionCount: number }>(
    await db.execute(sql`
      select ${CYCLE_COLUMNS},
        (select count(*)::int from question_revision q where q.cycle_id = c.id)
          as "questionCount"
      from review_cycle c
      where c.id = ${id}::uuid and c.deleted_at is null
    `),
  );
  if (!cycle) return null;
  const participants = await selectParticipants(
    db,
    sql`cp.cycle_id = ${id}::uuid`,
    sql`p.display_name, cp.id`,
  );
  return { ...cycle, participants };
}
