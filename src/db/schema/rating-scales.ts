import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sourceColumns } from "./source";

/** A label in every supported locale. */
export type LocalizedText = { es: string; en: string };

export const ratingScale = pgTable(
  "rating_scale",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: jsonb("name").$type<LocalizedText>().notNull(),
    /** Stable key for system scales (used by the seeder), null for custom ones. */
    systemKey: text("system_key").unique(),
    version: integer("version").notNull().default(1),
    isSystem: boolean("is_system").notNull().default(false),
    ...sourceColumns,
  },
  (t) => [unique().on(t.sourceSystem, t.sourceId)],
);

export const ratingScaleOption = pgTable(
  "rating_scale_option",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scaleId: uuid("scale_id")
      .notNull()
      .references(() => ratingScale.id, { onDelete: "cascade" }),
    value: numeric("value", { mode: "number" }).notNull(),
    /** (value - min) / (max - min) over the scale: comparable across scales. */
    normalized: numeric("normalized", { mode: "number" }).notNull(),
    sort: integer("sort").notNull(),
    label: jsonb("label").$type<LocalizedText>().notNull(),
  },
  (t) => [unique().on(t.scaleId, t.value)],
);

export type RatingScale = typeof ratingScale.$inferSelect;
export type RatingScaleOption = typeof ratingScaleOption.$inferSelect;
