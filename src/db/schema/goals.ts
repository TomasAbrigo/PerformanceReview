import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { person } from "./people";
import { sourceColumns, timestamps } from "./source";

export const goalStatuses = ["in_progress", "completed", "closed"] as const;
export type GoalStatus = (typeof goalStatuses)[number];

export const goalStatus = pgEnum("goal_status", goalStatuses);

/**
 * A goal of a person (the owner). Imported goals are never deleted: when
 * Bamboo closes one it stays here with status `closed`.
 */
export const goal = pgTable(
  "goal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    title: text("title").notNull(),
    description: text("description"),
    percentComplete: integer("percent_complete").notNull().default(0),
    status: goalStatus("status").notNull().default("in_progress"),
    dueDate: date("due_date"),
    completionDate: date("completion_date"),
    /** Bamboo's lastChangedDateTime. */
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),
    /** Bamboo's alignsWithOptionId, kept as the source's own id. */
    alignsWithSourceId: text("aligns_with_source_id"),
    /**
     * Comments Bamboo reported at the last successful comment sync: comments
     * are only re-fetched when the reported count differs from this one.
     */
    commentCount: integer("comment_count").notNull().default(0),
    ...sourceColumns,
  },
  (t) => [
    unique("goal_source_uq").on(t.sourceSystem, t.sourceId),
    index("goal_person_idx").on(t.personId),
    check(
      "goal_percent_complete_range",
      sql`${t.percentComplete} between 0 and 100`,
    ),
  ],
);

export type Goal = typeof goal.$inferSelect;

export const goalMilestone = pgTable(
  "goal_milestone",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goal.id),
    title: text("title").notNull(),
    /** Order inside the goal, as Bamboo listed them. */
    position: integer("position").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastUpdateAt: timestamp("last_update_at", { withTimezone: true }),
    ...sourceColumns,
  },
  (t) => [
    unique("goal_milestone_source_uq").on(t.sourceSystem, t.sourceId),
    index("goal_milestone_goal_idx").on(t.goalId),
  ],
);

export type GoalMilestone = typeof goalMilestone.$inferSelect;

export const goalComment = pgTable(
  "goal_comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goal.id),
    /** Null when the author could not be matched to a person. */
    authorPersonId: uuid("author_person_id").references(() => person.id),
    /** Bamboo's user id of the author (not an employee id). */
    authorSourceUserId: text("author_source_user_id"),
    text: text("text").notNull(),
    /** When the comment was posted (the row's own created_at is the audit one). */
    postedAt: timestamp("posted_at", { withTimezone: true }),
    ...sourceColumns,
  },
  (t) => [
    unique("goal_comment_source_uq").on(t.sourceSystem, t.sourceId),
    index("goal_comment_goal_idx").on(t.goalId),
  ],
);

export type GoalComment = typeof goalComment.$inferSelect;

/** A goal shared with (visible to) another person besides its owner. */
export const goalShare = pgTable(
  "goal_share",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goal.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    ...timestamps,
  },
  (t) => [
    unique("goal_share_goal_person_uq").on(t.goalId, t.personId),
    index("goal_share_person_idx").on(t.personId),
  ],
);

export type GoalShare = typeof goalShare.$inferSelect;
