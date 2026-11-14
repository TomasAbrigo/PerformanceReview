import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { goal, goalStatus } from "./goals";
import { person } from "./people";
import { cycleParticipant, reviewCycle } from "./review-cycles";

/**
 * A goal of a participant as it was when the cycle took its snapshot (at
 * launch, or when the participant was added): title, status, progress and due
 * date "as of" `captured_at`. Goals created later never appear; the "update
 * progress" action refreshes the figures of these rows (`refreshed_at`) and
 * flags the ones that were deleted (`no_longer_applicable`), it never adds
 * rows. These rows never feed the final rating or the calibration: the goals
 * rating is a separate question (see `question.role`).
 */
export const participantGoalSnapshot = pgTable(
  "participant_goal_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => cycleParticipant.id, { onDelete: "cascade" }),
    /** Null once the goal row is gone (the snapshot keeps its own copy). */
    goalId: uuid("goal_id").references(() => goal.id, {
      onDelete: "set null",
    }),
    /**
     * `source_system:source_id` of the goal (`native:<goal id>` for native
     * goals): the same source id may exist in two source systems.
     */
    goalSourceKey: text("goal_source_key").notNull(),
    title: text("title").notNull(),
    status: goalStatus("status").notNull(),
    percentComplete: integer("percent_complete").notNull(),
    dueDate: date("due_date"),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Last "update progress"; the legend date is this one, else captured_at. */
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
    /** The goal was deleted after the snapshot ("ya no aplica"). */
    noLongerApplicable: boolean("no_longer_applicable")
      .notNull()
      .default(false),
  },
  (t) => [
    unique("participant_goal_snapshot_participant_goal_uq").on(
      t.participantId,
      t.goalSourceKey,
    ),
    index("participant_goal_snapshot_goal_idx").on(t.goalId),
  ],
);

/**
 * Explicit goal <-> cycle link (People attaches a goal the period overlap
 * did not pick up). It feeds the snapshot of the goal's owner.
 */
export const cycleGoalLink = pgTable(
  "cycle_goal_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycle.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goal.id, { onDelete: "cascade" }),
    linkedBy: uuid("linked_by").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("cycle_goal_link_cycle_goal_uq").on(t.cycleId, t.goalId)],
);

export type ParticipantGoalSnapshot =
  typeof participantGoalSnapshot.$inferSelect;
export type CycleGoalLink = typeof cycleGoalLink.$inferSelect;
