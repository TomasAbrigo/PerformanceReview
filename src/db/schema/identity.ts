import { sql } from "drizzle-orm";
import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ingestRun, rawRecord } from "./ingest";
import { sourceSystem } from "./source";

/**
 * Why a record needs a human:
 * - `no_match`: nothing matched and nothing resembles it (strict mode only).
 * - `ambiguous`: not matched by the source's own id, but candidates exist.
 * - `conflict`: an identifier it carries is held by another person (the record
 *   itself was applied, minus that identifier).
 */
export const identityIssueReasons = [
  "no_match",
  "ambiguous",
  "conflict",
] as const;
export type IdentityIssueReason = (typeof identityIssueReasons)[number];

export const identityIssueStatuses = ["open", "resolved", "ignored"] as const;
export type IdentityIssueStatus = (typeof identityIssueStatuses)[number];

export const identityIssueReason = pgEnum(
  "identity_issue_reason",
  identityIssueReasons,
);
export const identityIssueStatus = pgEnum(
  "identity_issue_status",
  identityIssueStatuses,
);

/** What made a person a candidate; `name_hire_date` only ever proposes. */
export type IdentityMatchKind =
  "bamboo_id" | "employee_number" | "work_email" | "name_hire_date";

export type IdentityCandidate = {
  personId: string;
  /** 0..1, how strongly the matched keys point at this person. */
  score: number;
  matchedOn: IdentityMatchKind[];
};

export type IdentityResolution = {
  action: "link" | "create" | "ignore";
  personId?: string;
  actorNote?: string;
};

/**
 * A record the ingest could not attach to a person on its own. Keeps the raw
 * payload so resolving it re-processes the row through the normal upsert.
 * Only one open issue per source record; resolved/ignored ones are history.
 */
export const identityMatchIssue = pgTable(
  "identity_match_issue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ingestRunId: uuid("ingest_run_id")
      .notNull()
      .references(() => ingestRun.id),
    sourceSystem: sourceSystem("source_system").notNull(),
    entity: text("entity").notNull(),
    sourceId: text("source_id").notNull(),
    rawRecordId: uuid("raw_record_id").references(() => rawRecord.id),
    payload: jsonb("payload").notNull(),
    reason: identityIssueReason("reason").notNull(),
    candidates: jsonb("candidates")
      .$type<IdentityCandidate[]>()
      .notNull()
      .default([]),
    status: identityIssueStatus("status").notNull().default("open"),
    resolution: jsonb("resolution").$type<IdentityResolution>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("identity_match_issue_open_uq")
      .on(t.sourceSystem, t.entity, t.sourceId)
      .where(sql`status = 'open'`),
  ],
);

export type IdentityMatchIssue = typeof identityMatchIssue.$inferSelect;
export type NewIdentityMatchIssue = typeof identityMatchIssue.$inferInsert;
