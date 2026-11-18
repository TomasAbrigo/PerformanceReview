import {
  date,
  index,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { orgAttributeKinds } from "../../modules/org-attributes/kinds";
import { person } from "./people";
import { sourceColumns } from "./source";

export const orgAttributeKind = pgEnum("org_attribute_kind", orgAttributeKinds);

/**
 * An organizational attribute of a person with its validity: the account,
 * project, delivery manager (`dm`) or Santex lead they belong to. It comes
 * from a file People maintain (profile `org-attributes`), not from Bamboo, so
 * the history lives here and analytics read it as of each cycle's snapshot
 * date (`valid_from <= date <= valid_to`, `valid_to` null = open).
 *
 * For `dm` and `santex_lead` the value is a name; `ref_person_id` is the
 * person it resolves to when exactly one matches (null otherwise: the value
 * still groups and filters). A cell that is emptied in the file soft-deletes
 * its row (`deleted_at`).
 */
export const personOrgAttribute = pgTable(
  "person_org_attribute",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    kind: orgAttributeKind("kind").notNull(),
    value: text("value").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    refPersonId: uuid("ref_person_id").references(() => person.id, {
      onDelete: "set null",
    }),
    ...sourceColumns,
  },
  (t) => [
    unique("person_org_attribute_person_kind_from_uq").on(
      t.personId,
      t.kind,
      t.validFrom,
    ),
    index("person_org_attribute_kind_value_idx").on(t.kind, t.value),
  ],
);

export type PersonOrgAttribute = typeof personOrgAttribute.$inferSelect;
