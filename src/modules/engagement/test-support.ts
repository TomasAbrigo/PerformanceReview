/** Test-only builders of monthly engagement (db tests): rows written straight to the table. */
import { db } from "@/db/client";
import { engagementMonthly } from "@/db/schema";
import { type EngagementSegment } from "./kinds";

export async function insertEngagement(e: {
  personId: string;
  /** First day of the month, ISO. */
  month: string;
  score?: number | null;
  segment: EngagementSegment;
  deleted?: boolean;
  /** The file gave the segment (kept whatever the cutoffs); default true. */
  fromFile?: boolean;
}): Promise<void> {
  await db.insert(engagementMonthly).values({
    personId: e.personId,
    month: e.month,
    score:
      e.score === null || e.score === undefined ? null : e.score.toFixed(4),
    segment: e.segment,
    segmentFromFile: e.fromFile ?? true,
    deletedAt: e.deleted ? new Date() : null,
  });
}
