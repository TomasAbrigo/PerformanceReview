import {
  type AnyPgColumn,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { type LocalizedText, ratingScale } from "./rating-scales";
import { sourceColumns } from "./source";

import type {
  QuestionKind,
  QuestionRole,
  Relationship,
} from "../../modules/templates/constants";

export {
  type QuestionKind,
  questionKinds,
  type QuestionRole,
  questionRoles,
  type Relationship,
  relationships,
} from "../../modules/templates/constants";

export type Choice = { value: string; label: LocalizedText };

export const reviewTemplate = pgTable(
  "review_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: jsonb("name").$type<LocalizedText>().notNull(),
    description: jsonb("description").$type<LocalizedText>(),
    /** Stable key for system templates (used by the seeder). */
    systemKey: text("system_key").unique(),
    isSystem: boolean("is_system").notNull().default(false),
    /** Off for templates not offered yet (e.g. upward in v1). */
    enabled: boolean("enabled").notNull().default(true),
    clonedFromId: uuid("cloned_from_id").references(
      (): AnyPgColumn => reviewTemplate.id,
      { onDelete: "set null" },
    ),
    ...sourceColumns,
  },
  (t) => [unique().on(t.sourceSystem, t.sourceId)],
);

export const templateSection = pgTable("template_section", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id")
    .notNull()
    .references(() => reviewTemplate.id, { onDelete: "cascade" }),
  sort: integer("sort").notNull(),
  title: jsonb("title").$type<LocalizedText>().notNull(),
});

export const question = pgTable("question", {
  id: uuid("id").primaryKey().defaultRandom(),
  sectionId: uuid("section_id")
    .notNull()
    .references(() => templateSection.id, { onDelete: "cascade" }),
  sort: integer("sort").notNull(),
  kind: text("kind").$type<QuestionKind>().notNull(),
  appliesTo: text("applies_to").array().$type<Relationship[]>().notNull(),
  visibleToReviewee: boolean("visible_to_reviewee").notNull().default(true),
  required: boolean("required").notNull().default(false),
  scaleId: uuid("scale_id").references(() => ratingScale.id, {
    onDelete: "restrict",
  }),
  prompt: jsonb("prompt").$type<LocalizedText>().notNull(),
  choices: jsonb("choices").$type<Choice[]>(),
  /** Special meaning (e.g. the goals rating); null for ordinary questions. */
  role: text("role").$type<QuestionRole>(),
});

export type ReviewTemplate = typeof reviewTemplate.$inferSelect;
export type TemplateSection = typeof templateSection.$inferSelect;
export type Question = typeof question.$inferSelect;
