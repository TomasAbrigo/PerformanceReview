import { and, count, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { cycleParticipant, cycleTransition, reviewCycle } from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import type { CycleStatus } from "@/modules/review-core/status";
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

/**
 * Tells every active participant of the cycle that it moved `from` -> `to`.
 * Called by review-core's `launchCycle` and `transition` right after they log
 * the change, inside their transaction: the log's row count numbers the
 * change, so the same change is notified once, while going back to a phase
 * and forward again is a new one.
 */
export async function notifyPhaseChanged(
  db: DbOrTx,
  cycleId: string,
  from: CycleStatus,
  to: CycleStatus,
): Promise<number> {
  const cycleName = await cycleNameOf(db, cycleId);
  if (cycleName === null) return 0;
  const [{ n }] = await db
    .select({ n: count() })
    .from(cycleTransition)
    .where(eq(cycleTransition.cycleId, cycleId));
  const participants = await db
    .select({ personId: cycleParticipant.revieweePersonId })
    .from(cycleParticipant)
    .where(
      and(
        eq(cycleParticipant.cycleId, cycleId),
        isNull(cycleParticipant.removedAt),
      ),
    );
  return createNotifications(
    db,
    participants.map((p): NotificationInput => ({
      recipientPersonId: p.personId,
      kind: "cycle_phase_changed",
      cycleId,
      payload: { cycleName, fromStatus: from, toStatus: to },
      dedupeKey: `cycle_phase_changed:${cycleId}:${n}:${p.personId}`,
    })),
  );
}

// ---------------------------------------------------------------------------
// Events raised by other slices (#12 sharing, #14 feedback, #16 calibration).
// Each one is idempotent: calling it again for the same event creates nothing.

/**
 * A review was shared with its reviewee (`requestId`: the shared request).
 * `senderName`: who shared it (omit to show the People team).
 * Returns whether it was created.
 */
export async function notifyReviewShared(
  db: DbOrTx,
  input: {
    cycleId: string;
    requestId: string;
    recipientPersonId: string;
    senderName?: string | null;
    /** Distinguishes a second share of the same request (default: none). */
    dedupeSuffix?: string;
  },
): Promise<boolean> {
  const cycleName = await cycleNameOf(db, input.cycleId);
  if (cycleName === null) return false;
  return createNotification(db, {
    recipientPersonId: input.recipientPersonId,
    kind: "review_shared",
    cycleId: input.cycleId,
    requestId: input.requestId,
    payload: { cycleName, senderName: input.senderName ?? null },
    dedupeKey: `review_shared:${input.requestId}${input.dedupeSuffix ? `:${input.dedupeSuffix}` : ""}`,
  });
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
