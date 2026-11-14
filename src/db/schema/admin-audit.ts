import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AdminAction,
  AdminTargetType,
  AuditSnapshot,
} from "../../modules/review-core/ops-constants";
import { person } from "./people";
import { reviewCycle } from "./review-cycles";

/**
 * Append-only log of administrative actions on a cycle (#17): participants
 * added/removed, due dates extended, unlocks, reviews completed on behalf and
 * alternate assessors. One row per action, written in the same transaction
 * as the change, with the state before and after as JSON.
 */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null when HR acts as the People team without a person. */
    actorPersonId: uuid("actor_person_id").references(() => person.id),
    action: text("action").$type<AdminAction>().notNull(),
    targetType: text("target_type").$type<AdminTargetType>().notNull(),
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
