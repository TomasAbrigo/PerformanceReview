import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { ingestRun } from "./ingest";
import { identityMatchIssue } from "./identity";
import { questionRevision, reviewCycle } from "./review-cycles";
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
    /** inserted | updated | unchanged | issues */
    result: text("result").notNull(),
    participantsCreated: integer("participants_created").notNull().default(0),
    requestsCreated: integer("requests_created").notNull().default(0),
    requestsUnchanged: integer("requests_unchanged").notNull().default(0),
    answersCreated: integer("answers_created").notNull().default(0),
    answersUnchanged: integer("answers_unchanged").notNull().default(0),
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
