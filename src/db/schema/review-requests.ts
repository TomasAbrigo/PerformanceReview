import {
  boolean,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  requestStatuses,
  reviewActions,
} from "../../modules/review-core/request-status";
import { person } from "./people";
import {
  cycleParticipant,
  questionRevision,
  reviewCycle,
} from "./review-cycles";
import { sourceColumns } from "./source";
import { relationships } from "./templates";

export const reviewRelationship = pgEnum("review_relationship", relationships);
export const reviewRequestStatus = pgEnum(
  "review_request_status",
  requestStatuses,
);
export const reviewAuditAction = pgEnum("review_audit_action", reviewActions);

/** One review to write: who (reviewer) writes about whom (participant). */
export const reviewRequest = pgTable(
  "review_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycle.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => cycleParticipant.id, { onDelete: "cascade" }),
    /** Null when the reviewer could not be resolved (see reviewerMissing). */
    reviewerPersonId: uuid("reviewer_person_id").references(() => person.id),
    relationship: reviewRelationship("relationship").notNull(),
    status: reviewRequestStatus("status").notNull().default("draft"),
    anonymous: boolean("anonymous").notNull().default(false),
    /** Manager request whose participant had no manager at the snapshot. */
    reviewerMissing: boolean("reviewer_missing").notNull().default(false),
    /** Submitted by someone who is no longer the snapshot manager. */
    reviewerMismatch: boolean("reviewer_mismatch").notNull().default(false),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    declineReason: text("decline_reason"),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
    unlockedBy: uuid("unlocked_by").references(() => person.id),
    /** Manager review shared with the reviewee (visible to them from then). */
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    sharedBy: uuid("shared_by").references(() => person.id),
    ...sourceColumns,
  },
  (t) => [
    unique("review_request_participant_rel_reviewer_uq")
      .on(t.participantId, t.relationship, t.reviewerPersonId)
      .nullsNotDistinct(),
    unique().on(t.sourceSystem, t.sourceId),
    index("review_request_reviewer_idx").on(t.reviewerPersonId, t.status),
    index("review_request_cycle_idx").on(t.cycleId),
  ],
);

/** The answer of a request to one question revision. */
export const answer = pgTable(
  "answer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => reviewRequest.id, { onDelete: "cascade" }),
    questionRevisionId: uuid("question_revision_id")
      .notNull()
      .references(() => questionRevision.id, { onDelete: "cascade" }),
    /** Rating: the chosen scale value. */
    optionValue: numeric("option_value", { mode: "number" }),
    /** Rating: option label (es) as shown; single choice: the choice value. */
    optionLabel: text("option_label"),
    /** Rating: 0-1 normalized value from the scale snapshot. */
    normalized: numeric("normalized", { mode: "number" }),
    textValue: text("text_value"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("answer_request_question_uq").on(t.requestId, t.questionRevisionId),
  ],
);

/** Audit log of sensitive request actions (unlock, ...). */
export const reviewAudit = pgTable(
  "review_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => reviewRequest.id, { onDelete: "cascade" }),
    action: reviewAuditAction("action").notNull(),
    actorPersonId: uuid("actor_person_id").references(() => person.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("review_audit_request_idx").on(t.requestId, t.createdAt)],
);

export type ReviewRequest = typeof reviewRequest.$inferSelect;
export type Answer = typeof answer.$inferSelect;
export type ReviewAudit = typeof reviewAudit.$inferSelect;
