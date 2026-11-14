// Drizzle-free: shared by the domain and client components.

/** Days after sharing the employee has to acknowledge (at least). */
export const DEFAULT_ACK_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Last instant to acknowledge: the later of the end (UTC) of the
 * `acknowledge` due date (the participant's own, else the cycle's) and
 * `windowDays` after the review was shared. The due date can extend the
 * window but never shorten it: a review shared after it is not born expired.
 */
export function acknowledgeDeadline({
  sharedAt,
  dueDate,
  windowDays = DEFAULT_ACK_WINDOW_DAYS,
}: {
  sharedAt: Date;
  /** ISO date (YYYY-MM-DD) of the acknowledge phase, if any. */
  dueDate?: string | null;
  windowDays?: number;
}): Date {
  const window = sharedAt.getTime() + windowDays * DAY_MS;
  if (!dueDate) return new Date(window);
  const due = new Date(`${dueDate}T23:59:59.999Z`).getTime();
  return new Date(Math.max(due, window));
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

/** A shared review the employee still has to acknowledge (a /me task). */
export type AckTask = {
  participantId: string;
  cycleId: string;
  cycleName: string;
  sharedAt: Date;
  deadline: Date;
};
