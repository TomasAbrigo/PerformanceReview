// Drizzle-free: shared by the domain and client components.

/** Days after sharing the employee has to acknowledge (no cycle due date). */
export const DEFAULT_ACK_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Last instant to acknowledge: the end (UTC) of the cycle's `acknowledge`
 * due date when it has one, else `windowDays` after the review was shared.
 */
export function acknowledgeDeadline({
  sharedAt,
  dueDate,
  windowDays = DEFAULT_ACK_WINDOW_DAYS,
}: {
  sharedAt: Date;
  /** ISO date (YYYY-MM-DD) of the cycle's acknowledge phase, if any. */
  dueDate?: string | null;
  windowDays?: number;
}): Date {
  if (dueDate) return new Date(`${dueDate}T23:59:59.999Z`);
  return new Date(sharedAt.getTime() + windowDays * DAY_MS);
}

export type AckStatus = "not_shared" | "open" | "expired" | "acknowledged";

export function ackStatus({
  sharedAt,
  acknowledgedAt,
  deadline,
  now,
}: {
  sharedAt: Date | null;
  acknowledgedAt: Date | null;
  deadline: Date | null;
  now: Date;
}): AckStatus {
  if (acknowledgedAt) return "acknowledged";
  if (!sharedAt || !deadline) return "not_shared";
  return now.getTime() <= deadline.getTime() ? "open" : "expired";
}
