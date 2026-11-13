import {
  date,
  pgTable,
  text,
  timestamp,
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
    uniqueIndex("source_identity_system_kind_value_uq").on(
      t.sourceSystem,
      t.kind,
      t.value,
    ),
  ],
);

export type SourceIdentity = typeof sourceIdentity.$inferSelect;

/** Employment period of a person (hire → termination). */
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
  (t) => [uniqueIndex("employment_source_uq").on(t.sourceSystem, t.sourceId)],
);

export type Employment = typeof employment.$inferSelect;
