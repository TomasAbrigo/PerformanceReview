import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Settings People changed in the app (`/settings/insights`). Only overridden
 * keys are stored: the keys, their validation and their defaults live in code
 * (`src/modules/settings/definitions.ts`). Every change is also written to
 * `admin_audit_log`.
 */
export const appSetting = pgTable("app_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  /**
   * Person the actor was acting as; null when People acted without one. Not a
   * foreign key: the seed empties `person` and leaves the settings alone.
   */
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AppSetting = typeof appSetting.$inferSelect;
