// Drizzle-free constants shared by the schema, the domain and client components.
import type { CycleStatus } from "@/modules/review-core/status";
import type { Relationship } from "@/modules/templates/constants";

export const notificationKinds = [
  "reminder_due",
  "manual_reminder",
  "review_shared",
  "feedback_received",
  "calibration_published",
  "cycle_phase_changed",
] as const;
export type NotificationKind = (typeof notificationKinds)[number];

/**
 * The variables a notification's text is rendered from (messages live in
 * `Notifications.messages.<kind>` of src/messages). Never the rendered text:
 * the reader's locale decides the language when it is shown.
 */
export type NotificationPayload = {
  cycleName?: string;
  /** Deadline (ISO date) a reminder is about. */
  dueDate?: string;
  /** Days from the day the reminder was generated to `dueDate`. */
  daysLeft?: number;
  /** What kind of review the reminder is about. */
  relationship?: Relationship;
  /** Reviewee of the review (not set for self assessments). */
  participantName?: string;
  /** Who sent a manual reminder; null/absent: the People team. */
  senderName?: string | null;
  fromStatus?: CycleStatus;
  toStatus?: CycleStatus;
};
