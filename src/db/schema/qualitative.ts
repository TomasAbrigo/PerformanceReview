import {
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  analysisRunStatuses,
  sentiments,
  substances,
} from "../../modules/qualitative-analysis/constants";
import { person } from "./people";
import { answer } from "./review-requests";
import { reviewCycle } from "./review-cycles";

export const sentiment = pgEnum("sentiment", sentiments);
export const substance = pgEnum("analysis_substance", substances);
export const analysisRunStatus = pgEnum(
  "analysis_run_status",
  analysisRunStatuses,
);

/** One run of the qualitative analysis (or a label import). Never stores content. */
export const analysisRun = pgTable("analysis_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** mock | anthropic | import */
  provider: text("provider").notNull(),
  model: text("model"),
  promptVersion: text("prompt_version").notNull(),
  status: analysisRunStatus("status").notNull().default("running"),
  textsTotal: integer("texts_total").notNull().default(0),
  textsAnalyzed: integer("texts_analyzed").notNull().default(0),
  textsCached: integer("texts_cached").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** Error code or message; never analyzed text. */
  error: text("error"),
  cycleId: uuid("cycle_id").references(() => reviewCycle.id, {
    onDelete: "set null",
  }),
  triggeredBy: uuid("triggered_by").references(() => person.id),
});

/** A machine (or imported) label of one open-text answer. */
export const qualitativeAnalysis = pgTable(
  "qualitative_analysis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answer.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    promptVersion: text("prompt_version").notNull(),
    dimension: text("dimension").notNull(),
    sentiment: sentiment("sentiment").notNull(),
    confidence: numeric("confidence", { mode: "number" }),
    themes: text("themes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Null on an imported label (a CSV does not carry it) and on old labels. */
    substance: substance("substance"),
    /** Keys of `signals` (constants.ts); a provider may only use those. */
    signals: text("signals")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    textHash: text("text_hash").notNull(),
    /** md5 of answer.text_value when labeled: a different value means stale. */
    sourceMd5: text("source_md5").notNull(),
    runId: uuid("run_id").references(() => analysisRun.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("qualitative_analysis_answer_provider_prompt_uq").on(
      t.answerId,
      t.provider,
      t.promptVersion,
    ),
    check(
      "qualitative_analysis_confidence_ck",
      sql`${t.confidence} is null or (${t.confidence} >= 0 and ${t.confidence} <= 1)`,
    ),
  ],
);

/** Human correction of a label: append-only, never overwritten by a run. */
export const analysisCorrection = pgTable(
  "analysis_correction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answer.id, { onDelete: "cascade" }),
    previousSentiment: sentiment("previous_sentiment"),
    newSentiment: sentiment("new_sentiment").notNull(),
    previousThemes: text("previous_themes").array(),
    newThemes: text("new_themes").array().notNull(),
    previousSubstance: substance("previous_substance"),
    /** Null: the correction leaves the label's substance as it was. */
    newSubstance: substance("new_substance"),
    previousSignals: text("previous_signals").array(),
    /** Null: the correction leaves the label's signals as they were. */
    newSignals: text("new_signals").array(),
    actorPersonId: uuid("actor_person_id").references(() => person.id),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("analysis_correction_answer_idx").on(t.answerId, t.createdAt)],
);

/** Theme catalog per dimension (normalized name is the key). */
export const theme = pgTable(
  "theme",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dimension: text("dimension").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
  },
  (t) => [unique("theme_dimension_name_uq").on(t.dimension, t.normalizedName)],
);

export type AnalysisRun = typeof analysisRun.$inferSelect;
export type QualitativeAnalysis = typeof qualitativeAnalysis.$inferSelect;
export type AnalysisCorrection = typeof analysisCorrection.$inferSelect;
