import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { person } from "./people";
import { reviewCycle } from "./review-cycles";

/** JSON stored in admin_audit_log.before / after. */
export type AuditSnapshot = Record<string, unknown>;

/**
 * Append-only log of administrative actions on a cycle. The cycle operations
 * that wrote it (#17) were removed in #54; the rows are kept as history.
 */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null when HR acts as the People team without a person. */
    actorPersonId: uuid("actor_person_id").references(() => person.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    /** Id of the cycle, participant or request the action was about. */
    targetId: uuid("target_id").notNull(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycle.id, { onDelete: "cascade" }),
    before: jsonb("before").$type<AuditSnapshot>(),
    after: jsonb("after").$type<AuditSnapshot>(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("admin_audit_log_cycle_idx").on(t.cycleId, t.createdAt)],
);

export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
