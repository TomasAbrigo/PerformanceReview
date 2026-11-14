import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  notificationKinds,
  type NotificationPayload,
} from "../../modules/notifications/kinds";
import { person } from "./people";
import { reviewCycle } from "./review-cycles";
import { reviewRequest } from "./review-requests";

export const notificationKind = pgEnum("notification_kind", notificationKinds);

/**
 * Internal inbox entry (no email in v1). The text is never stored: it is
 * rendered from `kind` + `payload` in the reader's locale.
 */
export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientPersonId: uuid("recipient_person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    kind: notificationKind("kind").notNull(),
    cycleId: uuid("cycle_id").references(() => reviewCycle.id, {
      onDelete: "cascade",
    }),
    requestId: uuid("request_id").references(() => reviewRequest.id, {
      onDelete: "cascade",
    }),
    payload: jsonb("payload")
      .$type<NotificationPayload>()
      .notNull()
      .default({}),
    /**
     * Identifies the event behind the notification, so creating it twice is a
     * no-op (e.g. `reminder_due:<requestId>:<offsetDays>:<dueDate>`).
     */
    dedupeKey: text("dedupe_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    index("notification_recipient_idx").on(
      t.recipientPersonId,
      t.readAt,
      t.createdAt,
    ),
  ],
);

export type Notification = typeof notification.$inferSelect;
export type NewNotification = typeof notification.$inferInsert;
