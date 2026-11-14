import {
  boolean,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  calibrationGroupKinds,
  finalRatingStages,
} from "../../modules/review-core/calibration-constants";
import { person } from "./people";
import { cycleParticipant, reviewCycle } from "./review-cycles";

export const calibrationGroupKind = pgEnum(
  "calibration_group_kind",
  calibrationGroupKinds,
);
export const finalRatingStage = pgEnum("final_rating_stage", finalRatingStages);

/** Criteria a group was built with (department, manager id, or none). */
export type CalibrationCriteria = {
  department?: string;
  managerPersonId?: string;
};

/** A set of participants of a cycle calibrated together. */
export const calibrationGroup = pgTable(
  "calibration_group",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycle.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: calibrationGroupKind("kind").notNull(),
    criteria: jsonb("criteria").$type<CalibrationCriteria>().notNull(),
    createdBy: uuid("created_by").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("calibration_group_cycle_idx").on(t.cycleId)],
);

export const calibrationGroupMember = pgTable(
  "calibration_group_member",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => calibrationGroup.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => cycleParticipant.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.participantId] })],
);

/** People who may see a group's table (read-only by default). */
export const calibrationGroupCalibrator = pgTable(
  "calibration_group_calibrator",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => calibrationGroup.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    readOnly: boolean("read_only").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.personId] })],
);

/**
 * APPEND-ONLY log of a participant's final rating: every manager submit,
 * calibration proposal or override adds a row; no code path updates or
 * deletes rows. The current value is the view v_current_rating.
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
    /** Marked to discuss in the calibration meeting. */
    flagged: boolean("flagged").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("final_rating_participant_idx").on(t.participantId, t.createdAt),
  ],
);

export type CalibrationGroup = typeof calibrationGroup.$inferSelect;
export type FinalRating = typeof finalRating.$inferSelect;
