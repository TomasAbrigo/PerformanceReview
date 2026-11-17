import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { ingestRun } from "./ingest";
import { answer, reviewRequest } from "./review-requests";
import { questionRevision, reviewCycle } from "./review-cycles";

/**
 * Equivalences of a closed question's source option (a Bamboo letter) to the
 * 1-5 Likert value, per question role and option count (docs/likert-mapping.md).
 * `default` rows are seeded on server start; `custom` rows are edits by People
 * and are never overwritten by the seeder.
 */
export const likertMapping = pgTable(
  "likert_mapping",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Question role: retention | engagement. */
    role: text("role").notNull(),
    /** The option as exported ("A"). */
    sourceOption: text("source_option").notNull(),
    /** How many options the source question had (5: A-E, 4: A-D). */
    optionCount: integer("option_count").notNull(),
    value: integer("value").notNull(),
    /** default | custom */
    source: text("source").$type<"default" | "custom">().notNull(),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("likert_mapping_role_count_option_uq").on(
      t.role,
      t.optionCount,
      t.sourceOption,
    ),
  ],
);

export const answerQualityReasons = [
  "unmapped_option",
  "invalid_value",
] as const;
export type AnswerQualityReason = (typeof answerQualityReasons)[number];

/**
 * An imported answer the importer could not interpret (an option without
 * equivalence). The answer is kept with the raw value as its label and no
 * value; the issue says where it came from. `resolved_at` is set when a later
 * import maps it.
 */
export const answerQualityIssue = pgTable(
  "answer_quality_issue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    answerId: uuid("answer_id").references(() => answer.id, {
      onDelete: "set null",
    }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => reviewRequest.id, { onDelete: "cascade" }),
    questionRevisionId: uuid("question_revision_id")
      .notNull()
      .references(() => questionRevision.id, { onDelete: "cascade" }),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycle.id, { onDelete: "cascade" }),
    columnKey: text("column_key").notNull(),
    rawValue: text("raw_value").notNull(),
    reason: text("reason").$type<AnswerQualityReason>().notNull(),
    runId: uuid("run_id").references(() => ingestRun.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    unique("answer_quality_issue_request_question_uq").on(
      t.requestId,
      t.questionRevisionId,
    ),
    index("answer_quality_issue_cycle_idx").on(t.cycleId),
  ],
);

export type LikertMapping = typeof likertMapping.$inferSelect;
export type AnswerQualityIssue = typeof answerQualityIssue.$inferSelect;
