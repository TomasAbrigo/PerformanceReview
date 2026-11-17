import {
  boolean,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { finalRatingStages } from "../../modules/review-core/rating-constants";
import { person } from "./people";
import { cycleParticipant } from "./review-cycles";

export const finalRatingStage = pgEnum("final_rating_stage", finalRatingStages);

/**
 * APPEND-ONLY log of a participant's final rating (manager, calibrated or
 * override stages, kept as data): no code path updates or deletes rows. The
 * current value is the view v_current_rating, which the dashboards read.
 */
export const finalRating = pgTable(
  "final_rating",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => cycleParticipant.id, { onDelete: "cascade" }),
    stage: finalRatingStage("stage").notNull(),
    optionValue: numeric("option_value", { mode: "number" }).notNull(),
    /** Option label (es) as chosen. */
    optionLabel: text("option_label"),
    normalized: numeric("normalized", { mode: "number" }),
    actorPersonId: uuid("actor_person_id").references(() => person.id),
    reason: text("reason"),
    flagged: boolean("flagged").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("final_rating_participant_idx").on(t.participantId, t.createdAt),
  ],
);

export type FinalRating = typeof finalRating.$inferSelect;
