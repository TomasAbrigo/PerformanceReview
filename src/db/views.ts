import {
  boolean,
  numeric,
  pgView,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { finalRatingStage } from "./schema/calibration";

// Views live outside src/db/schema (drizzle-kit would see them twice via
// index.ts) and are created by hand in migrations: see src/db/sql/.

/**
 * Current rating per participant: override > calibrated > manager >
 * computed, then the latest row. Created by hand in the migration (see
 * src/db/sql/v_current_rating.sql); declared here only to query it.
 */
export const vCurrentRating = pgView("v_current_rating", {
  id: uuid("id").notNull(),
  participantId: uuid("participant_id").notNull(),
  stage: finalRatingStage("stage").notNull(),
  optionValue: numeric("option_value", { mode: "number" }).notNull(),
  optionLabel: text("option_label"),
  normalized: numeric("normalized", { mode: "number" }),
  actorPersonId: uuid("actor_person_id"),
  reason: text("reason"),
  flagged: boolean("flagged").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}).existing();
