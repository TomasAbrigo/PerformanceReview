import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  isNull,
  sql,
} from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  type CycleParticipant,
  person,
  questionRevision,
  reviewCycle,
  type ReviewCycle,
} from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import { jobsAsOf, type IsoDate } from "@/modules/org-history/queries";

/**
 * Org snapshots of reviewees as of `date`, via one org-history jobsAsOf query.
 * Also used by the historical import (src/modules/import-history).
 */
export async function snapshots(
  db: DbOrTx,
  cycleId: string,
  personIds: string[],
  date: IsoDate,
) {
  const jobs = await jobsAsOf(db, personIds, date);
  return personIds.map((personId) => {
    const job = jobs.get(personId);
    return {
      cycleId,
      revieweePersonId: personId,
      snapshotAsOf: date,
      snapManagerPersonId: job?.managerPersonId ?? null,
      snapDepartment: job?.department ?? null,
      snapDivision: job?.division ?? null,
      snapJobTitle: job?.jobTitle ?? null,
      snapLocation: job?.location ?? null,
      snapJobHistoryId: job?.id ?? null,
    };
  });
}

// ----------------------------------------------------------------- reads

export type CycleListItem = ReviewCycle & { participantCount: number };

export async function listCycles(db: DbOrTx): Promise<CycleListItem[]> {
  return db
    .select({
      ...getTableColumns(reviewCycle),
      participantCount: sql<number>`(select count(*)::int from ${cycleParticipant} cp
        where cp.cycle_id = "review_cycle"."id" and cp.removed_at is null)`,
    })
    .from(reviewCycle)
    .where(isNull(reviewCycle.deletedAt))
    .orderBy(desc(reviewCycle.createdAt));
}

export type CycleParticipantItem = CycleParticipant & {
  displayName: string;
  snapManagerName: string | null;
  /** Flag: nobody to write the manager review in the snapshot. */
  withoutManager: boolean;
};

export type CycleDetail = ReviewCycle & {
  participants: CycleParticipantItem[];
  questionCount: number;
  stats: { active: number; removed: number; withoutManager: number };
};

export async function getCycle(
  db: DbOrTx,
  id: string,
): Promise<CycleDetail | null> {
  if (!isUuid(id)) return null;
  const [cycle] = await db
    .select()
    .from(reviewCycle)
    .where(and(eq(reviewCycle.id, id), isNull(reviewCycle.deletedAt)));
  if (!cycle) return null;
  const reviewee = aliasedTable(person, "reviewee");
  const manager = aliasedTable(person, "manager");
  const participantRows: Omit<CycleParticipantItem, "withoutManager">[] =
    await db
      .select({
        ...getTableColumns(cycleParticipant),
        displayName: reviewee.displayName,
        snapManagerName: manager.displayName,
      })
      .from(cycleParticipant)
      .innerJoin(reviewee, eq(reviewee.id, cycleParticipant.revieweePersonId))
      .leftJoin(manager, eq(manager.id, cycleParticipant.snapManagerPersonId))
      .where(eq(cycleParticipant.cycleId, id))
      .orderBy(asc(reviewee.displayName));
  const counts = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(questionRevision)
    .where(eq(questionRevision.cycleId, id));
  const participants = participantRows.map((r) => ({
    ...r,
    withoutManager: r.snapManagerPersonId === null,
  }));
  const active = participants.filter((p) => !p.removedAt);
  return {
    ...cycle,
    participants,
    questionCount: counts[0]?.count ?? 0,
    stats: {
      active: active.length,
      removed: participants.length - active.length,
      withoutManager: active.filter((p) => p.withoutManager).length,
    },
  };
}
