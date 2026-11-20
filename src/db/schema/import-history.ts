import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { ingestRun } from "./ingest";
import { identityMatchIssue } from "./identity";
import {
  cycleParticipant,
  questionRevision,
  reviewCycle,
} from "./review-cycles";
import { sourceSystem } from "./source";
import { reviewRequest } from "./review-requests";

/**
 * Historical import (Bamboo report exports, issue #22). Imported cycles have
 * no template: their question revisions are synthesized from the report's
 * question columns, one per (cycle, column key), so re-importing finds them.
 */
export const importedQuestion = pgTable(
  "imported_question",
  {
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycle.id, { onDelete: "cascade" }),
    /** Stable key of the report column ("self:q1", "manager:custom:<text>"). */
    columnKey: text("column_key").notNull(),
    questionRevisionId: uuid("question_revision_id")
      .notNull()
      .references(() => questionRevision.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.cycleId, t.columnKey] })],
);

/**
 * What the report said about an imported request: the reviewer as named in
 * the file, and whether it differs from the manager in force at period end.
 */
export const importedRequest = pgTable("imported_request", {
  requestId: uuid("request_id")
    .primaryKey()
    .references(() => reviewRequest.id, { onDelete: "cascade" }),
  csvReviewerName: text("csv_reviewer_name"),
  reviewerMismatch: boolean("reviewer_mismatch").notNull().default(false),
  /**
   * The file's reviewer name matched nobody, so the snapshot manager was
   * assumed (#132): always a mismatch, never silent.
   */
  reviewerUnmatched: boolean("reviewer_unmatched").notNull().default(false),
});

/** One report row as processed by one run: what the result screen counts. */
export const historyImportRow = pgTable(
  "history_import_row",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => ingestRun.id, { onDelete: "cascade" }),
    entity: text("entity").notNull(),
    sourceId: text("source_id").notNull(),
    cycleId: uuid("cycle_id").references(() => reviewCycle.id, {
      onDelete: "cascade",
    }),
    /** inserted | updated | unchanged | issues | ignored | superseded */
    result: text("result").notNull(),
    participantsCreated: integer("participants_created").notNull().default(0),
    requestsCreated: integer("requests_created").notNull().default(0),
    requestsUnchanged: integer("requests_unchanged").notNull().default(0),
    answersCreated: integer("answers_created").notNull().default(0),
    answersUnchanged: integer("answers_unchanged").notNull().default(0),
    /** Requests that existed and whose content changed (#132). */
    requestsUpdated: integer("requests_updated").notNull().default(0),
    /** Requests dropped: the corrected row left that side empty (#132). */
    requestsRemoved: integer("requests_removed").notNull().default(0),
    /** Answers that existed and now hold another value (#132). */
    answersUpdated: integer("answers_updated").notNull().default(0),
    /** Answers dropped: the corrected row left the cell empty (#132). */
    answersRemoved: integer("answers_removed").notNull().default(0),
    /** Other rows of the same file with this key (#132): one wins by date. */
    duplicates: integer("duplicates").notNull().default(0),
    issueId: uuid("issue_id").references(() => identityMatchIssue.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("history_import_row_run_record_uq").on(
      t.runId,
      t.entity,
      t.sourceId,
    ),
    index("history_import_row_cycle_idx").on(t.runId, t.cycleId),
  ],
);

export type HistoryImportRow = typeof historyImportRow.$inferSelect;

/** One side of an assessment in Bamboo's Assessment Progress report. */
export const progressStatuses = [
  "not_started",
  "in_progress",
  "submitted",
  "not_applicable",
] as const;
export type ProgressStatus = (typeof progressStatuses)[number];
export const progressStatus = pgEnum("progress_status", progressStatuses);

/**
 * Completion of each participant of an imported cycle, as Bamboo's Assessment
 * Progress report tells it (issue #58): where the self and manager
 * assessments stand, whether the person counts as assessed, and the
 * follow-up notes. One row per (cycle, participant); re-imports update it.
 */
export const assessmentProgress = pgTable(
  "assessment_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycle.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => cycleParticipant.id, { onDelete: "cascade" }),
    selfStatus: progressStatus("self_status").notNull(),
    managerStatus: progressStatus("manager_status").notNull(),
    /** Bamboo's "Assessed" column says Complete. */
    assessed: boolean("assessed").notNull(),
    followUpNotes: text("follow_up_notes"),
    /** The Manager column as written in the report (the CURRENT manager). */
    csvManagerName: text("csv_manager_name"),
    /** The report's manager is not the participant's manager at snapshot. */
    reviewerMismatch: boolean("reviewer_mismatch").notNull().default(false),
    sourceSystem: sourceSystem("source_system").notNull(),
    sourceId: text("source_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    ingestRunId: uuid("ingest_run_id").references(() => ingestRun.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("assessment_progress_cycle_participant_uq").on(
      t.cycleId,
      t.participantId,
    ),
  ],
);

export type AssessmentProgress = typeof assessmentProgress.$inferSelect;
