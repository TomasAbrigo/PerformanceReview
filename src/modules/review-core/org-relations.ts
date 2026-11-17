import type { DbOrTx } from "@/db/client";
import type { CycleParticipant } from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { todayLocal } from "@/modules/org-history/dates";
import { jobAsOf, jobsAsOf, managerAsOf } from "@/modules/org-history/queries";

/**
 * Whether the actor is the participant's skip-level manager: the manager of
 * their snapshot manager, as of the participant's snapshot date.
 */
export async function isSkipLevel(
  db: DbOrTx,
  actor: ActorContext,
  participant: Pick<CycleParticipant, "snapManagerPersonId" | "snapshotAsOf">,
): Promise<boolean> {
  if (!actor.personId || !participant.snapManagerPersonId) return false;
  const job = await jobAsOf(
    db,
    participant.snapManagerPersonId,
    participant.snapshotAsOf,
  );
  return job?.managerPersonId === actor.personId;
}

/**
 * isSkipLevel for many participants at once: the ids of those whose snapshot
 * manager's manager, on the participant's snapshot date, is the actor. One
 * query per distinct snapshot date (a page of one cycle has one).
 */
export async function skipLevelParticipants(
  db: DbOrTx,
  actor: ActorContext,
  participants: Pick<
    CycleParticipant,
    "id" | "snapManagerPersonId" | "snapshotAsOf"
  >[],
): Promise<Set<string>> {
  const found = new Set<string>();
  if (!actor.personId) return found;
  const byDate = new Map<string, typeof participants>();
  for (const p of participants) {
    if (!p.snapManagerPersonId) continue;
    byDate.set(p.snapshotAsOf, [...(byDate.get(p.snapshotAsOf) ?? []), p]);
  }
  for (const [date, group] of byDate) {
    const jobs = await jobsAsOf(
      db,
      [...new Set(group.map((p) => p.snapManagerPersonId!))],
      date,
    );
    for (const p of group) {
      if (
        jobs.get(p.snapManagerPersonId!)?.managerPersonId === actor.personId
      ) {
        found.add(p.id);
      }
    }
  }
  return found;
}

/**
 * isCurrentManager for many people at once (one query): the ids, among
 * `personIds`, whose manager today is the actor.
 */
export async function currentManagerOf(
  db: DbOrTx,
  actor: ActorContext,
  personIds: string[],
  today: Date = new Date(),
): Promise<Set<string>> {
  if (!actor.personId || personIds.length === 0) return new Set();
  const jobs = await jobsAsOf(db, [...new Set(personIds)], todayLocal(today));
  return new Set(
    personIds.filter((id) => jobs.get(id)?.managerPersonId === actor.personId),
  );
}

/**
 * Whether the actor is the person's manager today (as of `today`, the
 * org-history job row valid now): the manager who follows their trajectory,
 * including cycles in which someone else managed them.
 */
export async function isCurrentManager(
  db: DbOrTx,
  actor: ActorContext,
  personId: string,
  today: Date = new Date(),
): Promise<boolean> {
  if (!actor.personId) return false;
  return (
    (await managerAsOf(db, personId, todayLocal(today))) === actor.personId
  );
}
