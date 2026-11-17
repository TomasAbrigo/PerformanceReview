import { and, asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  type LocalizedText,
  questionRevision,
  ratingScaleOption,
  reviewCycle,
} from "@/db/schema";
import { vCurrentRating } from "@/db/views";
import { isUuid } from "@/lib/uuid";
import type { FinalRatingStage } from "./rating-constants";

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
 * The participant's current final rating from v_current_rating (override >
 * calibrated > manager > computed, latest within a stage), or null when none
 * exists. Does NOT apply visibility: callers decide who may see it.
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
 * Options of a cycle's final scale: its final_scale_id, else the scale of
 * the question with role `overall_rating`.
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
        eq(questionRevision.role, "overall_rating"),
      ),
    )
    .limit(1);
  return q?.scale?.options ?? [];
}
