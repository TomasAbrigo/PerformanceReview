// Drizzle-free: used by client components.
import type { NotificationKind, NotificationPayload } from "./kinds";

/**
 * Where a notification takes the reader (a locale-less path for the
 * `Link` of `@/i18n/navigation`). The one place to point new kinds of
 * notification at their page: today only the self assessment form has its
 * own page for the reviewer; the rest land in the task inbox (/me), where
 * every pending task and its link live.
 */
export function notificationHref(n: {
  kind: NotificationKind;
  cycleId: string | null;
  payload: NotificationPayload;
}): string {
  if (
    (n.kind === "reminder_due" || n.kind === "manual_reminder") &&
    n.payload.relationship === "self" &&
    n.cycleId
  ) {
    return `/cycles/${n.cycleId}/self`;
  }
  return "/me";
}
