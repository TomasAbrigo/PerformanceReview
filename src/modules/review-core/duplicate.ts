import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleTemplateGroup,
  cycleTransition,
  reviewCycle,
  type ReviewCycle,
  reviewTemplate,
} from "@/db/schema";
import { parse } from "@/lib/domain-error";
import { CyclesError } from "./errors";
import { listGroupRows } from "./groups";
import { findCycle } from "./service";
import { DUPLICATE_NOTE_PREFIX, type DuplicateWarning } from "./status";
import { duplicateInput } from "./validation";

const MAX_SUFFIX = 40;

export type DuplicateResult = {
  cycle: ReviewCycle;
  /** What could not be copied (a template that is gone or switched off). */
  warnings: DuplicateWarning[];
};

/**
 * Copies a cycle (in any status) as a new draft named "<name> (<suffix>)":
 * components, anonymity, template, final scale, participant filter, schedule,
 * due dates (as they are: they have to be edited) and template groups. No
 * participants, questions or history come along, and the copy shares nothing
 * with the original (groups are new rows), so editing one never touches the
 * other. `actor` is recorded in the copy's status log.
 *
 * `suffix` is the word that goes between parentheses after the name; it is
 * a translated UI string, so the caller must provide it. Templates that were
 * deleted or switched off since are not copied: the copy gets no template (or
 * no such group) and the result says so.
 */
export async function duplicateCycle(
  db: DbOrTx,
  actor: string | null,
  cycleId: string,
  opts: { suffix: string },
): Promise<DuplicateResult> {
  const { suffix } = parse(duplicateInput, opts, CyclesError);
  return db.transaction(async (tx) => {
    const source = await findCycle(tx, cycleId);
    const groups = await listGroupRows(tx, source.id);

    const wanted = [
      ...new Set([
        ...(source.templateId ? [source.templateId] : []),
        ...groups.map((g) => g.templateId),
      ]),
    ];
    const usable = new Set(
      wanted.length === 0
        ? []
        : (
            await tx
              .select({ id: reviewTemplate.id })
              .from(reviewTemplate)
              .where(
                and(
                  inArray(reviewTemplate.id, wanted),
                  isNull(reviewTemplate.deletedAt),
                  eq(reviewTemplate.enabled, true),
                ),
              )
          ).map((t) => t.id),
    );
    const warnings: DuplicateWarning[] = [];
    const templateId =
      source.templateId && usable.has(source.templateId)
        ? source.templateId
        : null;
    if (source.templateId && !templateId) warnings.push({ kind: "template" });
    const keptGroups = groups.filter((g) => {
      if (usable.has(g.templateId)) return true;
      warnings.push({ kind: "group", name: g.name });
      return false;
    });

    const [copy] = await tx
      .insert(reviewCycle)
      .values({
        name: `${source.name} (${suffix.slice(0, MAX_SUFFIX)})`,
        description: source.description,
        periodStart: source.periodStart,
        periodEnd: source.periodEnd,
        snapshotDate: source.snapshotDate,
        components: source.components,
        anonymity: source.anonymity,
        finalScaleId: source.finalScaleId,
        templateId,
        dueDates: source.dueDates,
        scheduleKind: source.scheduleKind,
        hireDateSchedule: source.hireDateSchedule,
        participantFilter: source.participantFilter,
      })
      .returning();
    if (keptGroups.length > 0) {
      await tx.insert(cycleTemplateGroup).values(
        keptGroups.map((g, sort) => ({
          cycleId: copy.id,
          name: g.name,
          templateId: g.templateId,
          filter: g.filter,
          sort,
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
    return { cycle: copy, warnings };
  });
}
