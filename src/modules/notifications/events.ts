import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  person,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import type { CycleStatus } from "@/modules/review-core/status";
import { writablePhases } from "@/modules/review-core/visibility";
import { relationships } from "@/modules/templates/constants";
import {
  createNotification,
  createNotifications,
  type NotificationInput,
} from "./service";

async function cycleNameOf(
  db: DbOrTx,
  cycleId: string,
): Promise<string | null> {
  if (!isUuid(cycleId)) return null;
  const [cycle] = await db
    .select({ name: reviewCycle.name })
    .from(reviewCycle)
    .where(eq(reviewCycle.id, cycleId));
  return cycle?.name ?? null;
}

/** Display name of the person who sent something; null (People team) if none. */
async function senderNameOf(
  db: DbOrTx,
  personId: string | null | undefined,
): Promise<string | null> {
  if (!personId || !isUuid(personId)) return null;
  const [row] = await db
    .select({ name: person.displayName })
    .from(person)
    .where(eq(person.id, personId));
  return row?.name ?? null;
}

/**
 * Tells everyone the cycle's move `from` -> `to` concerns: its active
 * participants, and the reviewers whose work the new phase opens (a draft
 * request, of an active participant, that is writable in `to`), who need not
 * be participants themselves (a manager is not reviewed in the cycle they
 * review). Each person once.
 *
 * Called by review-core's `launchCycle` and `transition` right after they
 * log the change (and create the requests the phase needs), inside their
 * transaction; `transitionId` is the id of that `cycle_transition` row, so
 * the same change is notified once while going back to a phase and forward
 * again is a new one.
 */
export async function notifyPhaseChanged(
  db: DbOrTx,
  cycleId: string,
  from: CycleStatus,
  to: CycleStatus,
  transitionId: string,
): Promise<number> {
  const cycleName = await cycleNameOf(db, cycleId);
  if (cycleName === null) return 0;
  const participants = await db
    .select({ personId: cycleParticipant.revieweePersonId })
    .from(cycleParticipant)
    .where(
      and(
        eq(cycleParticipant.cycleId, cycleId),
        isNull(cycleParticipant.removedAt),
      ),
    );
  const opened = relationships.filter((r) => writablePhases[r].includes(to));
  const reviewers =
    opened.length === 0
      ? []
      : await db
          .selectDistinct({ personId: reviewRequest.reviewerPersonId })
          .from(reviewRequest)
          .innerJoin(
            cycleParticipant,
            eq(cycleParticipant.id, reviewRequest.participantId),
          )
          .where(
            and(
              eq(reviewRequest.cycleId, cycleId),
              eq(reviewRequest.status, "draft"),
              isNull(reviewRequest.deletedAt),
              isNull(cycleParticipant.removedAt),
              isNotNull(reviewRequest.reviewerPersonId),
              inArray(reviewRequest.relationship, opened),
            ),
          );
  const recipients = new Set<string>();
  for (const { personId } of [...participants, ...reviewers]) {
    if (personId) recipients.add(personId);
  }
  return createNotifications(
    db,
    [...recipients].map((recipientPersonId): NotificationInput => ({
      recipientPersonId,
      kind: "cycle_phase_changed",
      cycleId,
      payload: { cycleName, fromStatus: from, toStatus: to },
      dedupeKey: `cycle_phase_changed:${transitionId}:${recipientPersonId}`,
    })),
  );
}

// ---------------------------------------------------------------------------
// Events raised by other slices (#12 sharing, #14 feedback, #16 calibration).
// Each one is idempotent: calling it again for the same event creates nothing.

/**
 * Reviews were shared with their reviewees: `items` are the shared requests
 * and who they were about. `senderPersonId`: who shared them (omit for the
 * People team). `dedupeSuffix` tells apart a second share of the same request
 * (e.g. its `shared_at`; default: none). Returns how many were created.
 */
export async function notifyReviewsShared(
  db: DbOrTx,
  input: {
    cycleId: string;
    items: { requestId: string; recipientPersonId: string }[];
    senderPersonId?: string | null;
    dedupeSuffix?: string;
  },
): Promise<number> {
  if (input.items.length === 0) return 0;
  const cycleName = await cycleNameOf(db, input.cycleId);
  if (cycleName === null) return 0;
  const senderName = await senderNameOf(db, input.senderPersonId);
  const suffix = input.dedupeSuffix ? `:${input.dedupeSuffix}` : "";
  return createNotifications(
    db,
    input.items.map(({ requestId, recipientPersonId }): NotificationInput => ({
      recipientPersonId,
      kind: "review_shared",
      cycleId: input.cycleId,
      requestId,
      payload: { cycleName, senderName },
      dedupeKey: `review_shared:${requestId}${suffix}`,
    })),
  );
}

/** One review shared with its reviewee (see notifyReviewsShared). Returns whether it was created. */
export async function notifyReviewShared(
  db: DbOrTx,
  input: {
    cycleId: string;
    requestId: string;
    recipientPersonId: string;
    senderPersonId?: string | null;
    dedupeSuffix?: string;
  },
): Promise<boolean> {
  const { requestId, recipientPersonId, ...rest } = input;
  return (
    (await notifyReviewsShared(db, {
      ...rest,
      items: [{ requestId, recipientPersonId }],
    })) === 1
  );
}

/**
 * Feedback about the recipient was submitted (`requestId`: the feedback
 * request). The author is deliberately not in the payload: feedback can be
 * anonymous. Returns whether it was created.
 */
export async function notifyFeedbackReceived(
  db: DbOrTx,
  input: { cycleId: string; requestId: string; recipientPersonId: string },
): Promise<boolean> {
  const cycleName = await cycleNameOf(db, input.cycleId);
  if (cycleName === null) return false;
  return createNotification(db, {
    recipientPersonId: input.recipientPersonId,
    kind: "feedback_received",
    cycleId: input.cycleId,
    requestId: input.requestId,
    payload: { cycleName },
    dedupeKey: `feedback_received:${input.requestId}`,
  });
}

/**
 * The calibrated ratings of the cycle were published; tells each recipient
 * (typically the managers) once. Returns how many were newly notified.
 */
export async function notifyCalibrationPublished(
  db: DbOrTx,
  input: { cycleId: string; recipientPersonIds: string[] },
): Promise<number> {
  const cycleName = await cycleNameOf(db, input.cycleId);
  if (cycleName === null) return 0;
  return createNotifications(
    db,
    [...new Set(input.recipientPersonIds)].map(
      (recipientPersonId): NotificationInput => ({
        recipientPersonId,
        kind: "calibration_published",
        cycleId: input.cycleId,
        payload: { cycleName },
        dedupeKey: `calibration_published:${input.cycleId}:${recipientPersonId}`,
      }),
    ),
  );
}
