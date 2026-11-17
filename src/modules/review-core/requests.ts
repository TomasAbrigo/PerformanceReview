import { and, asc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  person,
  reviewCycle,
  reviewRequest,
  type ReviewRequest,
} from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { currentManagerOf, skipLevelParticipants } from "./org-relations";
import { ReviewError } from "./review-errors";
import { canRead, type VisibilityContext } from "./visibility";

/**
 * The fields of a request, its participant and its cycle that canRead (and
 * what it needs beyond the row) reads: a LoadedRow, or anything selected
 * with those columns.
 */
export type VisibilityRow = {
  request: Pick<
    ReviewRequest,
    "relationship" | "reviewerPersonId" | "status" | "sharedAt"
  >;
  participant: Pick<
    typeof cycleParticipant.$inferSelect,
    | "id"
    | "revieweePersonId"
    | "snapManagerPersonId"
    | "snapshotAsOf"
    | "removedAt"
  >;
  cycle: Pick<
    typeof reviewCycle.$inferSelect,
    "status" | "components" | "anonymity"
  >;
};

/**
 * What canRead needs beyond the rows, for many rows of one actor at once
 * (the lists read a page at a time): the participants' manager requests
 * (double blind, shared), whether peer feedback is released and whether the
 * actor is skip-level or the reviewee's current manager. Each extra
 * is one query per call, for the rows that need it, never one per row; none
 * when the actor is HR or has no person. Rows the actor wrote need nothing
 * (they read their own).
 */
export async function visibilityContexts(
  db: DbOrTx,
  actor: ActorContext,
  rows: VisibilityRow[],
): Promise<VisibilityContext[]> {
  const contexts: VisibilityContext[] = rows.map((row) => ({ ...row }));
  const me = actor.personId;
  if (actor.role === "hr" || me === null) return contexts;
  const pending = rows
    .map((row, i) => ({ row, ctx: contexts[i] }))
    .filter(({ row }) => row.request.reviewerPersonId !== me);
  const idsOf = (list: typeof pending) => [
    ...new Set(list.map(({ row }) => row.participant.id)),
  ];

  const selfRows = pending.filter(
    ({ row }) => row.request.relationship === "self",
  );
  if (selfRows.length > 0) {
    // Superseded manager requests are history, not the double-blind gate.
    const managerRequests = await db
      .select({
        participantId: reviewRequest.participantId,
        status: reviewRequest.status,
        reviewer: reviewRequest.reviewerPersonId,
        sharedAt: reviewRequest.sharedAt,
      })
      .from(reviewRequest)
      .where(
        and(
          inArray(reviewRequest.participantId, idsOf(selfRows)),
          eq(reviewRequest.relationship, "manager"),
          isNull(reviewRequest.deletedAt),
          ne(reviewRequest.status, "superseded"),
        ),
      )
      .orderBy(asc(reviewRequest.requestedAt));
    for (const { row, ctx } of selfRows) {
      const mine = managerRequests.filter(
        (r) => r.participantId === row.participant.id,
      );
      ctx.managerRequest =
        mine.find((r) => r.reviewer === me) ?? mine[0] ?? null;
    }
  }

  // Peer/upward feedback read by the reviewee: released with the share.
  const asReviewee = pending.filter(
    ({ row }) =>
      (row.request.relationship === "peer" ||
        row.request.relationship === "upward") &&
      row.participant.revieweePersonId === me,
  );
  if (asReviewee.length > 0) {
    const needShare = asReviewee.filter(
      ({ row }) =>
        peerFeedbackReleased(row.cycle) && row.cycle.components.manager,
    );
    const shared = await sharedManagerReviews(db, idsOf(needShare));
    for (const { row, ctx } of asReviewee) {
      ctx.revieweeShared =
        peerFeedbackReleased(row.cycle) &&
        (!row.cycle.components.manager || shared.has(row.participant.id));
    }
  }

  // The snapshot manager and the reviewee are decided without skip-level.
  const undecided = pending.filter(
    ({ row }) =>
      row.participant.snapManagerPersonId !== me &&
      row.participant.revieweePersonId !== me,
  );
  if (undecided.length > 0) {
    const skip = await skipLevelParticipants(
      db,
      actor,
      undecided.map(({ row }) => row.participant),
    );
    // Whoever manages the reviewee today follows their trajectory (#15).
    const current = await currentManagerOf(
      db,
      actor,
      undecided.map(({ row }) => row.participant.revieweePersonId),
    );
    for (const { row, ctx } of undecided) {
      ctx.skipLevel = skip.has(row.participant.id);
      ctx.currentManager = current.has(row.participant.revieweePersonId);
    }
  }
  return contexts;
}

/** The cycle phases that release peer/upward feedback to the reviewee. */
const peerFeedbackReleased = (cycle: Pick<VisibilityRow["cycle"], "status">) =>
  cycle.status === "sharing" || cycle.status === "closed";

/** Ids (of the given participants) whose manager review was shared with them. */
async function sharedManagerReviews(
  db: DbOrTx,
  participantIds: string[],
): Promise<Set<string>> {
  if (participantIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ id: reviewRequest.participantId })
    .from(reviewRequest)
    .where(
      and(
        inArray(reviewRequest.participantId, participantIds),
        eq(reviewRequest.relationship, "manager"),
        isNotNull(reviewRequest.sharedAt),
        isNull(reviewRequest.deletedAt),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/**
 * Whether peer/upward feedback is released to the reviewee: the cycle is in
 * sharing (or closed) and, when the cycle has manager reviews, the
 * participant's manager review was shared; without managers, the phase
 * alone releases it.
 */
export async function peerFeedbackShared(
  db: DbOrTx,
  row: Pick<VisibilityRow, "cycle"> & {
    participant: Pick<VisibilityRow["participant"], "id">;
  },
): Promise<boolean> {
  if (!peerFeedbackReleased(row.cycle)) return false;
  if (!row.cycle.components.manager) return true;
  return (await sharedManagerReviews(db, [row.participant.id])).has(
    row.participant.id,
  );
}

/** A request with what visibility needs; throws not_found / forbidden. */
export async function loadRequest(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
  { forUpdate = false } = {},
) {
  if (!isUuid(requestId)) throw new ReviewError("not_found");
  const query = db
    .select({
      request: reviewRequest,
      participant: cycleParticipant,
      cycle: reviewCycle,
    })
    .from(reviewRequest)
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .innerJoin(reviewCycle, eq(reviewCycle.id, reviewRequest.cycleId))
    .where(
      and(eq(reviewRequest.id, requestId), isNull(reviewRequest.deletedAt)),
    );
  const [row] = forUpdate
    ? await query.for("update", { of: reviewRequest })
    : await query;
  if (!row || row.cycle.deletedAt) throw new ReviewError("not_found");
  const [visibility] = await visibilityContexts(db, actor, [row]);
  if (!canRead(actor, visibility)) throw new ReviewError("forbidden");
  return { ...row, visibility };
}

/** Display name of a person (header "acting as"). */
export async function personName(
  db: DbOrTx,
  personId: string | null,
): Promise<string | null> {
  if (!personId || !isUuid(personId)) return null;
  const [row] = await db
    .select({ name: person.displayName })
    .from(person)
    .where(eq(person.id, personId));
  return row?.name ?? null;
}
