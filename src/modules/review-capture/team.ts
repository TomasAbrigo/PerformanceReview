import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  person,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import type { LocalizedText } from "@/db/schema/rating-scales";
import type { ActorContext } from "@/modules/actor/types";
import { type RequestState, requestState } from "@/modules/assessments/state";
import type { RequestStatus } from "@/modules/review-core/request-status";
import { visibilityContexts } from "@/modules/review-core/requests";
import { canRead } from "@/modules/review-core/visibility";

export type TeamReview = {
  managerRequestId: string;
  managerStatus: RequestStatus;
  /** The manager review reached the reviewee. */
  shared: boolean;
  /** The person's self request and where it stands for the actor. */
  selfRequestId: string | null;
  selfState: RequestState;
  person: { id: string; name: string };
  participantId: string;
  cycleId: string;
  cycleName: string;
  localizedName: LocalizedText | null;
  periodEnd: string;
  dueDate: string | null;
};

/**
 * The manager reviews the actor writes today: one per direct report still in
 * a cycle not closed (the request is the actor's, superseded ones never
 * count), with where the person's self assessment stands as far as canRead
 * lets the actor know. Latest period first, then by name.
 */
export async function listTeamReviews(
  db: DbOrTx,
  actor: ActorContext,
): Promise<TeamReview[]> {
  if (actor.personId === null || actor.role === "direction") return [];
  const rows = await db
    .select({
      request: reviewRequest,
      participant: cycleParticipant,
      cycle: reviewCycle,
      name: person.displayName,
    })
    .from(reviewRequest)
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .innerJoin(reviewCycle, eq(reviewCycle.id, reviewRequest.cycleId))
    .innerJoin(person, eq(person.id, cycleParticipant.revieweePersonId))
    .where(
      and(
        eq(reviewRequest.reviewerPersonId, actor.personId),
        eq(reviewRequest.relationship, "manager"),
        ne(reviewRequest.status, "superseded"),
        ne(reviewRequest.status, "declined"),
        isNull(reviewRequest.deletedAt),
        isNull(reviewCycle.deletedAt),
        ne(reviewCycle.status, "closed"),
        isNull(cycleParticipant.removedAt),
      ),
    )
    .orderBy(desc(reviewCycle.periodEnd), asc(person.displayName));
  if (rows.length === 0) return [];
  const selves = await db
    .select()
    .from(reviewRequest)
    .where(
      and(
        inArray(
          reviewRequest.participantId,
          rows.map((r) => r.participant.id),
        ),
        eq(reviewRequest.relationship, "self"),
        isNull(reviewRequest.deletedAt),
        ne(reviewRequest.status, "superseded"),
      ),
    );
  const selfOf = new Map(selves.map((r) => [r.participantId, r]));
  const withSelf = rows.filter((r) => selfOf.has(r.participant.id));
  const contexts = await visibilityContexts(
    db,
    actor,
    withSelf.map(({ participant, cycle }) => ({
      request: selfOf.get(participant.id)!,
      participant,
      cycle,
    })),
  );
  const readable = new Map(
    withSelf.map((r, i) => [r.participant.id, canRead(actor, contexts[i])]),
  );
  return rows.map(({ request, participant, cycle, name }) => {
    const self = selfOf.get(participant.id) ?? null;
    return {
      managerRequestId: request.id,
      managerStatus: request.status,
      shared: request.sharedAt !== null,
      selfRequestId: self?.id ?? null,
      selfState: requestState(self, !!readable.get(participant.id)),
      person: { id: participant.revieweePersonId, name },
      participantId: participant.id,
      cycleId: cycle.id,
      cycleName: cycle.name,
      localizedName: cycle.localizedName,
      periodEnd: cycle.periodEnd,
      dueDate: cycle.dueDates.manager ?? null,
    };
  });
}
