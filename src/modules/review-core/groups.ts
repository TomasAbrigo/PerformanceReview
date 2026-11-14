import {
  and,
  asc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import type { ZodType } from "zod";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  cycleTemplateGroup,
  type CycleTemplateGroup,
  questionRevision,
  reviewTemplate,
} from "@/db/schema";
import type { LocalizedText } from "@/db/schema/rating-scales";
import { parse as parseOr } from "@/lib/domain-error";
import { todayLocal } from "@/modules/org-history/dates";
import type { IsoDate } from "@/modules/org-history/queries";
import { CyclesError } from "./errors";
import { copyQuestions, findCycle, matchParticipants } from "./service";
import {
  type CycleGroupInput,
  cycleGroupsInput,
  type ParticipantFilterInput,
  previewGroupsInput,
} from "./validation";

/**
 * Templates per participant group: a cycle may send different people to
 * different templates. Groups are ordered; a participant goes to the FIRST
 * group whose filter matches them (resolved as of the same date as the
 * snapshot), else to the cycle's default template.
 */

const parse = <T>(schema: ZodType<T>, input: unknown): T =>
  parseOr(schema, input, CyclesError);

export const listGroupRows = (
  db: DbOrTx,
  cycleId: string,
): Promise<CycleTemplateGroup[]> =>
  db
    .select()
    .from(cycleTemplateGroup)
    .where(eq(cycleTemplateGroup.cycleId, cycleId))
    .orderBy(asc(cycleTemplateGroup.sort));

/**
 * Replaces the groups of a draft cycle (the order of `input` is the priority).
 * An empty list removes them all.
 */
export async function setCycleGroups(
  db: DbOrTx,
  cycleId: string,
  input: CycleGroupInput[],
): Promise<CycleTemplateGroup[]> {
  const groups = parse(cycleGroupsInput, input);
  return db.transaction(async (tx) => {
    const cycle = await findCycle(tx, cycleId);
    if (cycle.status !== "draft") throw new CyclesError("not_draft");

    const templateIds = [...new Set(groups.map((g) => g.templateId))];
    if (templateIds.length > 0) {
      const found = new Set(
        (
          await tx
            .select({ id: reviewTemplate.id })
            .from(reviewTemplate)
            .where(
              and(
                inArray(reviewTemplate.id, templateIds),
                isNull(reviewTemplate.deletedAt),
              ),
            )
        ).map((t) => t.id),
      );
      const missing = groups.flatMap((g, i) =>
        found.has(g.templateId)
          ? []
          : [{ path: `${i}.templateId`, message: "invalid" }],
      );
      if (missing.length > 0) throw new CyclesError("validation", missing);
    }

    await tx
      .delete(cycleTemplateGroup)
      .where(eq(cycleTemplateGroup.cycleId, cycleId));
    if (groups.length === 0) return [];
    return tx
      .insert(cycleTemplateGroup)
      .values(
        groups.map((g, sort) => ({
          cycleId,
          name: g.name,
          templateId: g.templateId,
          filter: g.filter,
          sort,
        })),
      )
      .returning();
  });
}

export type CycleGroupItem = CycleTemplateGroup & {
  templateName: LocalizedText;
  /** Active participants assigned to the group. */
  participantCount: number;
  /** Frozen questions of the group (0 until the cycle is launched). */
  questionCount: number;
};

export async function listCycleGroups(
  db: DbOrTx,
  cycleId: string,
): Promise<CycleGroupItem[]> {
  return db
    .select({
      ...getTableColumns(cycleTemplateGroup),
      templateName: reviewTemplate.name,
      participantCount: sql<number>`(select count(*)::int from ${cycleParticipant} cp
        where cp.template_group_id = ${cycleTemplateGroup.id} and cp.removed_at is null)`,
      questionCount: sql<number>`(select count(*)::int from ${questionRevision} qr
        where qr.group_id = ${cycleTemplateGroup.id})`,
    })
    .from(cycleTemplateGroup)
    .innerJoin(
      reviewTemplate,
      eq(reviewTemplate.id, cycleTemplateGroup.templateId),
    )
    .where(eq(cycleTemplateGroup.cycleId, cycleId))
    .orderBy(asc(cycleTemplateGroup.sort));
}

/**
 * Maps each person to the key of the first group matching them as of
 * `asOf` (null = no group, i.e. the default template).
 */
async function assignToGroups<K extends string | number>(
  db: DbOrTx,
  groups: { key: K; filter: ParticipantFilterInput }[],
  personIds: string[],
  asOf: IsoDate,
): Promise<Map<string, K | null>> {
  const assigned = new Map<string, K | null>(personIds.map((id) => [id, null]));
  if (groups.length === 0 || personIds.length === 0) return assigned;
  // Who each group matches, all at once; the order only decides ties below.
  const matches = await Promise.all(
    groups.map((g) => matchParticipants(db, g.filter, asOf)),
  );
  groups.forEach((group, i) => {
    for (const { personId } of matches[i]) {
      if (assigned.get(personId) === null) assigned.set(personId, group.key);
    }
  });
  return assigned;
}

/** Group (id) of each person in the cycle's saved groups, as of `asOf`. */
export async function assignCycleGroups(
  db: DbOrTx,
  cycleId: string,
  personIds: string[],
  asOf: IsoDate,
): Promise<Map<string, string | null>> {
  const groups = await listGroupRows(db, cycleId);
  return assignToGroups(
    db,
    groups.map((g) => ({ key: g.id, filter: g.filter })),
    personIds,
    asOf,
  );
}

/**
 * Launch hook: copies each group's template questions as revisions tagged
 * with the group, and returns the group of each participant.
 */
export async function freezeGroups(
  db: DbOrTx,
  cycleId: string,
  personIds: string[],
  asOf: IsoDate,
): Promise<Map<string, string | null>> {
  const groups = await listGroupRows(db, cycleId);
  for (const g of groups) {
    await copyQuestions(db, cycleId, g.templateId, g.id);
  }
  return assignToGroups(
    db,
    groups.map((g) => ({ key: g.id, filter: g.filter })),
    personIds,
    asOf,
  );
}

export type GroupsPreview = {
  /** People matching the cycle's participant filter. */
  total: number;
  /** People per group, in the order given (each person counts once). */
  groups: number[];
  /** People left without a group (they use the default template). */
  remainder: number;
};

/** What the wizard shows: how many people each group would get. */
export async function previewGroups(
  db: DbOrTx,
  participantFilter: ParticipantFilterInput,
  groupsInput: { filter: ParticipantFilterInput }[],
  asOf: IsoDate = todayLocal(),
): Promise<GroupsPreview> {
  const groups = parse(previewGroupsInput, groupsInput);
  const people = await matchParticipants(db, participantFilter, asOf);
  const assigned = await assignToGroups(
    db,
    groups.map((g, i) => ({ key: i, filter: g.filter })),
    people.map((p) => p.personId),
    asOf,
  );
  const counts = groups.map(() => 0);
  let remainder = 0;
  for (const key of assigned.values()) {
    if (key === null) remainder++;
    else counts[key]++;
  }
  return { total: people.length, groups: counts, remainder };
}
