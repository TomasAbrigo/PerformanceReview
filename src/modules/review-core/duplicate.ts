import type { DbOrTx } from "@/db/client";
import {
  cycleTemplateGroup,
  cycleTransition,
  reviewCycle,
  type ReviewCycle,
} from "@/db/schema";
import { listGroupRows } from "./groups";
import { findCycle } from "./service";
import { DUPLICATE_NOTE_PREFIX } from "./status";

const DEFAULT_SUFFIX = "Copia";
const MAX_SUFFIX = 40;

/**
 * Copies a cycle (in any status) as a new draft named "<name> (<suffix>)":
 * components, anonymity, template, final scale, participant filter, schedule,
 * due dates (as they are: they have to be edited) and template groups. No
 * participants, questions or history come along, and the copy shares nothing
 * with the original (groups are new rows), so editing one never touches the
 * other. `actor` is recorded in the copy's status log.
 */
export async function duplicateCycle(
  db: DbOrTx,
  actor: string | null,
  cycleId: string,
  opts: { suffix?: string } = {},
): Promise<ReviewCycle> {
  return db.transaction(async (tx) => {
    const source = await findCycle(tx, cycleId);
    const suffix = opts.suffix?.trim().slice(0, MAX_SUFFIX) || DEFAULT_SUFFIX;
    const [copy] = await tx
      .insert(reviewCycle)
      .values({
        name: `${source.name} (${suffix})`,
        description: source.description,
        periodStart: source.periodStart,
        periodEnd: source.periodEnd,
        snapshotDate: source.snapshotDate,
        components: source.components,
        anonymity: source.anonymity,
        finalScaleId: source.finalScaleId,
        templateId: source.templateId,
        dueDates: source.dueDates,
        scheduleKind: source.scheduleKind,
        hireDateSchedule: source.hireDateSchedule,
        participantFilter: source.participantFilter,
      })
      .returning();
    const groups = await listGroupRows(tx, source.id);
    if (groups.length > 0) {
      await tx.insert(cycleTemplateGroup).values(
        groups.map((g) => ({
          cycleId: copy.id,
          name: g.name,
          templateId: g.templateId,
          filter: g.filter,
          sort: g.sort,
        })),
      );
    }
    await tx.insert(cycleTransition).values({
      cycleId: copy.id,
      fromStatus: "draft",
      toStatus: "draft",
      actorPersonId: actor,
      note: `${DUPLICATE_NOTE_PREFIX}${source.id}`,
    });
    return copy;
  });
}
