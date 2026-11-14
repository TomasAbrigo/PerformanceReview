import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbOrTx } from "@/db/client";
import {
  answer,
  calibrationGroup,
  calibrationGroupCalibrator,
  calibrationGroupMember,
  cycleParticipant,
  finalRating,
  type LocalizedText,
  person,
  questionRevision,
  ratingScaleOption,
  reviewAudit,
  reviewCycle,
  reviewRequest,
  type ReviewRequest,
} from "@/db/schema";
import { vCurrentRating } from "@/db/views";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import type {
  CalibrationGroupKind,
  FinalRatingStage,
} from "./calibration-constants";
import { ReviewError } from "./review-errors";

export * from "./calibration-constants";

export type ScaleOption = {
  value: number;
  label: LocalizedText;
  normalized: number;
};

export type CurrentRating = {
  participantId: string;
  stage: FinalRatingStage;
  optionValue: number;
  optionLabel: string | null;
  normalized: number | null;
  createdAt: Date;
};

/**
 * STABLE API (used by #15 compare/history and #18): the participant's
 * current final rating from v_current_rating (override > calibrated >
 * manager > computed, latest within a stage), or null when none exists.
 * Does NOT apply visibility: callers decide who may see it (employees only
 * after share + publish, see myPublishedRating).
 */
export async function currentRatingFor(
  db: DbOrTx,
  participantId: string,
): Promise<CurrentRating | null> {
  if (!isUuid(participantId)) return null;
  const [row] = await db
    .select({
      participantId: vCurrentRating.participantId,
      stage: vCurrentRating.stage,
      optionValue: vCurrentRating.optionValue,
      optionLabel: vCurrentRating.optionLabel,
      normalized: vCurrentRating.normalized,
      createdAt: vCurrentRating.createdAt,
    })
    .from(vCurrentRating)
    .where(eq(vCurrentRating.participantId, participantId));
  return row ?? null;
}

/**
 * Hook for #18 (internal inbox): called after publishing with the
 * participants whose rating became final. No-op for now.
 */
export async function onCalibrationPublished(
  participantIds: string[],
): Promise<void> {
  void participantIds;
}

const isHr = (actor: ActorContext) => actor.role === "hr";

/**
 * The overall manager rating of a manager review: its LAST rating question
 * (highest sort), e.g. "Overall performance rating" in the system template.
 */
async function overallRating(db: DbOrTx, request: ReviewRequest) {
  const [row] = await db
    .select({
      value: answer.optionValue,
      label: answer.optionLabel,
      normalized: answer.normalized,
    })
    .from(answer)
    .innerJoin(
      questionRevision,
      eq(questionRevision.id, answer.questionRevisionId),
    )
    .where(
      and(
        eq(answer.requestId, request.id),
        eq(questionRevision.kind, "rating"),
        sql`'manager' = ANY(${questionRevision.appliesTo})`,
      ),
    )
    .orderBy(desc(questionRevision.sort))
    .limit(1);
  return row?.value == null ? null : row;
}

/**
 * Hook of submit(): a submitted manager review appends its overall rating
 * as a `manager` final_rating row. Other relationships: nothing.
 */
export async function recordManagerRating(
  db: DbOrTx,
  request: ReviewRequest,
): Promise<void> {
  if (request.relationship !== "manager") return;
  const rating = await overallRating(db, request);
  if (!rating) return;
  await db.insert(finalRating).values({
    participantId: request.participantId,
    stage: "manager",
    optionValue: rating.value!,
    optionLabel: rating.label,
    normalized: rating.normalized,
    actorPersonId: request.reviewerPersonId,
  });
}

/**
 * Options of a cycle's final scale: its final_scale_id, else the scale of
 * the overall manager question.
 */
export async function finalScale(
  db: DbOrTx,
  cycleId: string,
): Promise<ScaleOption[]> {
  const [cycle] = await db
    .select({ scaleId: reviewCycle.finalScaleId })
    .from(reviewCycle)
    .where(eq(reviewCycle.id, cycleId));
  if (cycle?.scaleId) {
    return db
      .select({
        value: ratingScaleOption.value,
        label: ratingScaleOption.label,
        normalized: ratingScaleOption.normalized,
      })
      .from(ratingScaleOption)
      .where(eq(ratingScaleOption.scaleId, cycle.scaleId))
      .orderBy(asc(ratingScaleOption.sort));
  }
  const [q] = await db
    .select({ scale: questionRevision.scale })
    .from(questionRevision)
    .where(
      and(
        eq(questionRevision.cycleId, cycleId),
        eq(questionRevision.kind, "rating"),
        sql`'manager' = ANY(${questionRevision.appliesTo})`,
      ),
    )
    .orderBy(desc(questionRevision.sort))
    .limit(1);
  return q?.scale?.options ?? [];
}

export type GroupInput =
  | { name: string; kind: "by_department"; department: string }
  | { name: string; kind: "by_manager"; managerPersonId: string }
  /** Without participantIds: every active participant of the cycle. */
  | { name: string; kind: "manual"; participantIds?: string[] };

const invalid = (path: string) =>
  new ReviewError("validation", [{ path, message: "invalid" }]);

/** HR creates a group; members are filled from the snapshot (or given). */
export async function createGroup(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
  input: GroupInput,
) {
  if (!isHr(actor)) throw new ReviewError("forbidden");
  if (!isUuid(cycleId)) throw new ReviewError("not_found");
  if (!input.name.trim()) {
    throw new ReviewError("validation", [
      { path: "name", message: "required" },
    ]);
  }
  if (input.kind === "by_manager" && !isUuid(input.managerPersonId)) {
    throw invalid("managerPersonId");
  }
  if (input.kind === "by_department" && !input.department?.trim()) {
    throw invalid("department");
  }
  return db.transaction(async (tx) => {
    const active = and(
      eq(cycleParticipant.cycleId, cycleId),
      isNull(cycleParticipant.removedAt),
    );
    const filter =
      input.kind === "by_department"
        ? eq(cycleParticipant.snapDepartment, input.department)
        : input.kind === "by_manager"
          ? eq(cycleParticipant.snapManagerPersonId, input.managerPersonId)
          : !input.participantIds
            ? undefined
            : input.participantIds.filter(isUuid).length
              ? inArray(
                  cycleParticipant.id,
                  input.participantIds.filter(isUuid),
                )
              : sql`false`;
    const members = await tx
      .select({ id: cycleParticipant.id })
      .from(cycleParticipant)
      .where(and(active, filter));
    const [group] = await tx
      .insert(calibrationGroup)
      .values({
        cycleId,
        name: input.name.trim(),
        kind: input.kind,
        criteria:
          input.kind === "by_department"
            ? { department: input.department }
            : input.kind === "by_manager"
              ? { managerPersonId: input.managerPersonId }
              : {},
        createdBy: actor.personId,
      })
      .returning();
    if (members.length) {
      await tx
        .insert(calibrationGroupMember)
        .values(
          members.map((m) => ({ groupId: group.id, participantId: m.id })),
        );
    }
    return group;
  });
}

/** HR adds a calibrator (read-only) to a group. Idempotent. */
export async function addCalibrator(
  db: DbOrTx,
  actor: ActorContext,
  groupId: string,
  personId: string,
  { readOnly = true }: { readOnly?: boolean } = {},
): Promise<void> {
  if (!isHr(actor)) throw new ReviewError("forbidden");
  if (!isUuid(groupId) || !isUuid(personId)) throw new ReviewError("not_found");
  await db
    .insert(calibrationGroupCalibrator)
    .values({ groupId, personId, readOnly })
    .onConflictDoUpdate({
      target: [
        calibrationGroupCalibrator.groupId,
        calibrationGroupCalibrator.personId,
      ],
      set: { readOnly },
    });
}

export type GroupItem = {
  id: string;
  name: string;
  kind: CalibrationGroupKind;
  members: number;
};

/** Groups of a cycle the actor may see (HR: all; calibrators: theirs). */
export async function listGroups(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
): Promise<GroupItem[]> {
  if (!isUuid(cycleId)) return [];
  if (!isHr(actor) && !actor.personId) return [];
  const mine = isHr(actor)
    ? undefined
    : inArray(
        calibrationGroup.id,
        db
          .select({ id: calibrationGroupCalibrator.groupId })
          .from(calibrationGroupCalibrator)
          .where(eq(calibrationGroupCalibrator.personId, actor.personId!)),
      );
  return db
    .select({
      id: calibrationGroup.id,
      name: calibrationGroup.name,
      kind: calibrationGroup.kind,
      members: sql<number>`count(${calibrationGroupMember.participantId})::int`,
    })
    .from(calibrationGroup)
    .leftJoin(
      calibrationGroupMember,
      eq(calibrationGroupMember.groupId, calibrationGroup.id),
    )
    .where(and(eq(calibrationGroup.cycleId, cycleId), mine))
    .groupBy(calibrationGroup.id)
    .orderBy(asc(calibrationGroup.createdAt));
}

/**
 * Index of the final-scale option a final_rating row falls in. Rows carry
 * the normalized value (0-1) of the scale they were chosen on: the manager
 * answers on the question's scale, which may differ from the cycle's final
 * scale, so we match by nearest normalized value; by value only when the
 * row has no normalized value.
 */
export function optionIndexFor(
  scale: ScaleOption[],
  row: { optionValue: number; normalized: number | null },
): number {
  if (row.normalized === null) {
    return scale.findIndex((o) => o.value === row.optionValue);
  }
  let best = -1;
  for (let i = 0; i < scale.length; i++) {
    const d = Math.abs(scale[i].normalized - row.normalized);
    if (best < 0 || d < Math.abs(scale[best].normalized - row.normalized)) {
      best = i;
    }
  }
  return best;
}

/** The actor's calibrator memberships in a cycle's groups. */
async function memberships(db: DbOrTx, actor: ActorContext, cycleId: string) {
  if (!actor.personId) return [];
  return db
    .select({
      groupId: calibrationGroupCalibrator.groupId,
      readOnly: calibrationGroupCalibrator.readOnly,
    })
    .from(calibrationGroupCalibrator)
    .innerJoin(
      calibrationGroup,
      eq(calibrationGroup.id, calibrationGroupCalibrator.groupId),
    )
    .where(
      and(
        eq(calibrationGroupCalibrator.personId, actor.personId),
        eq(calibrationGroup.cycleId, cycleId),
      ),
    );
}

export type RatingCell = {
  value: number;
  label: LocalizedText | null;
  stage: FinalRatingStage;
};

export type CalibrationRow = {
  participantId: string;
  revieweeName: string;
  managerName: string | null;
  department: string | null;
  managerRating: RatingCell | null;
  currentRating: RatingCell | null;
  flagged: boolean;
  history: {
    stage: FinalRatingStage;
    value: number;
    reason: string | null;
    createdAt: Date;
  }[];
};

export type CalibrationTable = {
  group: {
    id: string;
    cycleId: string;
    name: string;
    kind: CalibrationGroupKind;
  };
  canEdit: boolean;
  publishedAt: Date | null;
  scale: ScaleOption[];
  rows: CalibrationRow[];
};

/**
 * A group's table: participant, snapshot manager, original manager rating,
 * current rating, flag and reason history. HR edits; calibrators of the
 * group only read.
 */
export async function calibrationTable(
  db: DbOrTx,
  actor: ActorContext,
  groupId: string,
): Promise<CalibrationTable> {
  if (!isUuid(groupId)) throw new ReviewError("not_found");
  const [group] = await db
    .select()
    .from(calibrationGroup)
    .where(eq(calibrationGroup.id, groupId));
  if (!group) throw new ReviewError("not_found");
  const cal = isHr(actor)
    ? null
    : (await memberships(db, actor, group.cycleId)).find(
        (m) => m.groupId === groupId,
      );
  if (!isHr(actor) && !cal) throw new ReviewError("forbidden");
  const [cycle] = await db
    .select({ publishedAt: reviewCycle.calibrationPublishedAt })
    .from(reviewCycle)
    .where(eq(reviewCycle.id, group.cycleId));
  const scale = await finalScale(db, group.cycleId);
  const optionOf = (row: { optionValue: number; normalized: number | null }) =>
    scale[optionIndexFor(scale, row)] ?? null;
  const manager = alias(person, "manager");
  const members = await db
    .select({
      participantId: cycleParticipant.id,
      revieweeName: person.displayName,
      managerName: manager.displayName,
      department: cycleParticipant.snapDepartment,
    })
    .from(calibrationGroupMember)
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, calibrationGroupMember.participantId),
    )
    .innerJoin(person, eq(person.id, cycleParticipant.revieweePersonId))
    .leftJoin(manager, eq(manager.id, cycleParticipant.snapManagerPersonId))
    .where(eq(calibrationGroupMember.groupId, groupId))
    .orderBy(asc(person.displayName));
  const ids = members.map((m) => m.participantId);
  const log = ids.length
    ? await db
        .select()
        .from(finalRating)
        .where(inArray(finalRating.participantId, ids))
        .orderBy(asc(finalRating.createdAt))
    : [];
  const current = ids.length
    ? await db
        .select()
        .from(vCurrentRating)
        .where(inArray(vCurrentRating.participantId, ids))
    : [];
  return {
    group: {
      id: group.id,
      cycleId: group.cycleId,
      name: group.name,
      kind: group.kind,
    },
    // HR, or a calibrator of this group with read_only = false.
    canEdit: isHr(actor) || cal?.readOnly === false,
    publishedAt: cycle?.publishedAt ?? null,
    scale,
    rows: members.map((m) => {
      const mine = log.filter((r) => r.participantId === m.participantId);
      const original = mine.filter((r) => r.stage === "manager").at(-1);
      const cur = current.find((r) => r.participantId === m.participantId);
      const calibrated = mine.filter((r) => r.stage !== "manager");
      return {
        ...m,
        // As the manager chose it (their question's scale and label).
        managerRating: original
          ? {
              value: original.optionValue,
              label:
                optionOf(original)?.normalized === original.normalized
                  ? optionOf(original)!.label
                  : original.optionLabel
                    ? { es: original.optionLabel, en: original.optionLabel }
                    : null,
              stage: "manager" as const,
            }
          : null,
        currentRating: cur
          ? {
              value: optionOf(cur)?.value ?? cur.optionValue,
              label: optionOf(cur)?.label ?? null,
              stage: cur.stage,
            }
          : null,
        flagged: calibrated.at(-1)?.flagged ?? false,
        history: calibrated.map((r) => ({
          stage: r.stage,
          value: r.optionValue,
          reason: r.reason,
          createdAt: r.createdAt,
        })),
      };
    }),
  };
}

/**
 * HR (or a calibrator of one of the participant's groups with read_only =
 * false) proposes a rating: appends a `calibrated` row, or an `override`
 * row once the calibration is published (also audited as rating_override
 * on the manager request, since employees may already see it). The reason
 * is required and the value must be an option of the cycle's final scale.
 */
export async function proposeRating(
  db: DbOrTx,
  actor: ActorContext,
  participantId: string,
  input: { value: number; reason: string; flag?: boolean },
): Promise<void> {
  if (!isHr(actor) && !actor.personId) throw new ReviewError("forbidden");
  if (!isUuid(participantId)) throw new ReviewError("not_found");
  const [p] = await db
    .select({
      cycleId: cycleParticipant.cycleId,
      publishedAt: reviewCycle.calibrationPublishedAt,
    })
    .from(cycleParticipant)
    .innerJoin(reviewCycle, eq(reviewCycle.id, cycleParticipant.cycleId))
    .where(eq(cycleParticipant.id, participantId));
  if (!p) throw new ReviewError("not_found");
  if (!isHr(actor)) {
    const editable = (await memberships(db, actor, p.cycleId))
      .filter((m) => !m.readOnly)
      .map((m) => m.groupId);
    const [inGroup] = editable.length
      ? await db
          .select({ id: calibrationGroupMember.groupId })
          .from(calibrationGroupMember)
          .where(
            and(
              eq(calibrationGroupMember.participantId, participantId),
              inArray(calibrationGroupMember.groupId, editable),
            ),
          )
      : [];
    if (!inGroup) throw new ReviewError("forbidden");
  }
  const reason = input.reason?.trim() ?? "";
  if (!reason) throw new ReviewError("reason_required");
  const option = (await finalScale(db, p.cycleId)).find(
    (o) => o.value === Number(input.value),
  );
  if (!option) {
    throw new ReviewError("validation", [
      { path: "value", message: "invalid" },
    ]);
  }
  const override = p.publishedAt !== null;
  await db.transaction(async (tx) => {
    await tx.insert(finalRating).values({
      participantId,
      stage: override ? "override" : "calibrated",
      optionValue: option.value,
      optionLabel: option.label.es,
      normalized: option.normalized,
      actorPersonId: actor.personId,
      reason,
      flagged: !!input.flag,
    });
    if (!override) return;
    const [request] = await tx
      .select({ id: reviewRequest.id })
      .from(reviewRequest)
      .where(
        and(
          eq(reviewRequest.participantId, participantId),
          eq(reviewRequest.relationship, "manager"),
          isNull(reviewRequest.deletedAt),
        ),
      );
    if (request) {
      await tx.insert(reviewAudit).values({
        requestId: request.id,
        action: "rating_override",
        actorPersonId: actor.personId,
        note: reason,
      });
    }
  });
}

export type Distribution = {
  options: ScaleOption[];
  /** One series per department / snapshot manager; counts per option. */
  series: { key: string | null; label: string | null; counts: number[] }[];
};

/**
 * Histogram data of a cycle (no forced curve): participants per option of
 * the final scale (see optionIndexFor), grouped by department or snapshot
 * manager, using the original manager rating (`manager`) or the current one
 * (`current`). HR sees every participant; a calibrator only the members of
 * their groups (none: forbidden).
 */
export async function distribution(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
  opts: { groupBy: "department" | "manager"; stage: "manager" | "current" },
): Promise<Distribution> {
  if (!isUuid(cycleId)) throw new ReviewError("not_found");
  let scope;
  if (!isHr(actor)) {
    const groups = (await memberships(db, actor, cycleId)).map(
      (m) => m.groupId,
    );
    if (!groups.length) throw new ReviewError("forbidden");
    scope = inArray(
      cycleParticipant.id,
      db
        .select({ id: calibrationGroupMember.participantId })
        .from(calibrationGroupMember)
        .where(inArray(calibrationGroupMember.groupId, groups)),
    );
  }
  const options = await finalScale(db, cycleId);
  const manager = alias(person, "manager");
  const people = await db
    .select({
      participantId: cycleParticipant.id,
      department: cycleParticipant.snapDepartment,
      managerId: cycleParticipant.snapManagerPersonId,
      managerName: manager.displayName,
    })
    .from(cycleParticipant)
    .leftJoin(manager, eq(manager.id, cycleParticipant.snapManagerPersonId))
    .where(
      and(
        eq(cycleParticipant.cycleId, cycleId),
        isNull(cycleParticipant.removedAt),
        scope,
      ),
    );
  const ids = people.map((p) => p.participantId);
  const values = new Map<
    string,
    { optionValue: number; normalized: number | null }
  >();
  if (ids.length) {
    if (opts.stage === "current") {
      for (const r of await db
        .select()
        .from(vCurrentRating)
        .where(inArray(vCurrentRating.participantId, ids))) {
        values.set(r.participantId, r);
      }
    } else {
      for (const r of await db
        .select()
        .from(finalRating)
        .where(
          and(
            inArray(finalRating.participantId, ids),
            eq(finalRating.stage, "manager"),
          ),
        )
        .orderBy(asc(finalRating.createdAt))) {
        values.set(r.participantId, r);
      }
    }
  }
  const series = new Map<string, Distribution["series"][number]>();
  for (const p of people) {
    const v = values.get(p.participantId);
    const i = v ? optionIndexFor(options, v) : -1;
    if (i < 0) continue;
    const key = opts.groupBy === "department" ? p.department : p.managerId;
    const label = opts.groupBy === "department" ? p.department : p.managerName;
    const id = key ?? "";
    if (!series.has(id)) {
      series.set(id, { key, label, counts: options.map(() => 0) });
    }
    series.get(id)!.counts[i] += 1;
  }
  return {
    options,
    series: [...series.values()].sort((a, b) =>
      (a.label ?? "").localeCompare(b.label ?? ""),
    ),
  };
}

/**
 * HR publishes the calibration of a cycle: sets calibration_published_at,
 * audits `calibration_published` once per participant (on their manager
 * request) and calls onCalibrationPublished. Returns the participants
 * audited (0 when already published).
 */
export async function publishCalibration(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
): Promise<number> {
  if (!isHr(actor)) throw new ReviewError("forbidden");
  if (!isUuid(cycleId)) throw new ReviewError("not_found");
  const participantIds = await db.transaction(async (tx) => {
    const [cycle] = await tx
      .update(reviewCycle)
      .set({ calibrationPublishedAt: new Date() })
      .where(
        and(
          eq(reviewCycle.id, cycleId),
          isNull(reviewCycle.calibrationPublishedAt),
        ),
      )
      .returning({ id: reviewCycle.id });
    if (!cycle) return [];
    const requests = await tx
      .select({
        id: reviewRequest.id,
        participantId: reviewRequest.participantId,
      })
      .from(reviewRequest)
      .innerJoin(
        cycleParticipant,
        eq(cycleParticipant.id, reviewRequest.participantId),
      )
      .where(
        and(
          eq(reviewRequest.cycleId, cycleId),
          eq(reviewRequest.relationship, "manager"),
          isNull(reviewRequest.deletedAt),
          isNull(cycleParticipant.removedAt),
        ),
      );
    if (requests.length) {
      await tx.insert(reviewAudit).values(
        requests.map((r) => ({
          requestId: r.id,
          action: "calibration_published" as const,
          actorPersonId: actor.personId,
        })),
      );
    }
    return requests.map((r) => r.participantId);
  });
  if (participantIds.length) await onCalibrationPublished(participantIds);
  return participantIds.length;
}

/**
 * The actor's own final rating in a cycle, only once their manager review
 * is shared AND the calibration is published: just the value and label,
 * never the original rating, stage or reasons.
 */
export async function myPublishedRating(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
): Promise<{ value: number; label: LocalizedText | null } | null> {
  if (!actor.personId || !isUuid(cycleId)) return null;
  const [row] = await db
    .select({ participantId: cycleParticipant.id })
    .from(cycleParticipant)
    .innerJoin(reviewCycle, eq(reviewCycle.id, cycleParticipant.cycleId))
    .innerJoin(
      reviewRequest,
      and(
        eq(reviewRequest.participantId, cycleParticipant.id),
        eq(reviewRequest.relationship, "manager"),
        isNull(reviewRequest.deletedAt),
      ),
    )
    .where(
      and(
        eq(cycleParticipant.cycleId, cycleId),
        eq(cycleParticipant.revieweePersonId, actor.personId),
        eq(reviewRequest.status, "submitted"),
        sql`${reviewRequest.sharedAt} is not null`,
        sql`${reviewCycle.calibrationPublishedAt} is not null`,
      ),
    );
  if (!row) return null;
  const current = await currentRatingFor(db, row.participantId);
  if (!current) return null;
  const option = (await finalScale(db, cycleId)).find(
    (o) => o.value === current.optionValue,
  );
  return { value: current.optionValue, label: option?.label ?? null };
}
