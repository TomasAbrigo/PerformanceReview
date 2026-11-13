import { sql } from "drizzle-orm";
import {
  date,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sourceColumns, sourceSystem, timestamps } from "./common";

/** Golden person record (native). */
export const person = pgTable("person", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  workEmail: text("work_email"),
  ...timestamps(),
});

export type Person = typeof person.$inferSelect;

export const identityKinds = [
  "bamboo_id",
  "employee_number",
  "work_email",
] as const;
export type IdentityKind = (typeof identityKinds)[number];

/** An identifier a source system uses for a person, with validity. */
export const sourceIdentity = pgTable(
  "source_identity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    sourceSystem: sourceSystem("source_system").notNull(),
    kind: text("kind").$type<IdentityKind>().notNull(),
    value: text("value").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    // Only one OPEN holder per value; closed rows keep history and a value
    // can later be held again (by the same or another person).
    uniqueIndex("source_identity_open_uq")
      .on(t.sourceSystem, t.kind, t.value)
      .where(sql`valid_to is null`),
  ],
);

export type SourceIdentity = typeof sourceIdentity.$inferSelect;

/**
 * Employment period of a person (hire → termination). `source_id` is the
 * Bamboo employee id; a rehire under the same id is a new period, so periods
 * are keyed by (source_system, source_id, hire_date).
 */
export const employment = pgTable(
  "employment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    hireDate: date("hire_date"),
    terminationDate: date("termination_date"),
    status: text("status"),
    ...sourceColumns(),
  },
  (t) => [
    unique("employment_source_period_uq")
      .on(t.sourceSystem, t.sourceId, t.hireDate)
      .nullsNotDistinct(),
  ],
);

export type Employment = typeof employment.$inferSelect;
