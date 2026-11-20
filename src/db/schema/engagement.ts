import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { engagementSegments } from "../../modules/engagement/kinds";
import { person } from "./people";
import { sourceColumns } from "./source";

export const engagementSegment = pgEnum(
  "engagement_segment",
  engagementSegments,
);

/**
 * The monthly engagement of a person (file profile `engagement-monthly`, not
 * Bamboo): one row per person and month, `month` the first day of it. `score`
 * is 0-1 and null for `falta` (the person did not answer); `segment` is the
 * file's own, or derived from the score with the `engagement.cutoff*`
 * settings when the file has none. Re-importing a month updates its row.
 * `segment_from_file` says the file gave the segment: otherwise the views
 * recompute it from the score with the current cutoffs (#132), so changing
 * them in settings reaches months already imported.
 */
export const engagementMonthly = pgTable(
  "engagement_monthly",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    month: date("month").notNull(),
    score: numeric("score", { precision: 5, scale: 4 }),
    segment: engagementSegment("segment").notNull(),
    segmentFromFile: boolean("segment_from_file").notNull().default(false),
    ...sourceColumns,
  },
  (t) => [
    unique("engagement_monthly_person_month_uq").on(t.personId, t.month),
    index("engagement_monthly_month_idx").on(t.month),
    check(
      "engagement_monthly_score_range",
      sql`${t.score} is null or (${t.score} >= 0 and ${t.score} <= 1)`,
    ),
    check(
      "engagement_monthly_month_first",
      sql`extract(day from ${t.month}) = 1`,
    ),
  ],
);

export type EngagementMonthly = typeof engagementMonthly.$inferSelect;
