// Drizzle- and server-free: shared by the queries and the screens.
import type { RequestStatus } from "@/modules/review-core/request-status";

/**
 * Where one side (self or manager) of a participant's assessment stands for
 * the actor who looks at it. `locked`: the request exists but the actor may
 * not read it yet (what `canRead` decides: a self review before the manager's
 * under double blind, a manager review before it is shared with the
 * reviewee): the list says so without telling its status.
 */
export type RequestState =
  "none" | "draft" | "submitted" | "declined" | "locked";

export function requestState(
  request: { status: RequestStatus } | null,
  readable: boolean,
): RequestState {
  if (!request) return "none";
  if (!readable) return "locked";
  return request.status === "submitted"
    ? "submitted"
    : request.status === "declined"
      ? "declined"
      : "draft";
}

export const progressValues = ["complete", "partial", "pending"] as const;
export type Progress = (typeof progressValues)[number];

export const isProgressFilter = (value: unknown): value is Progress =>
  (progressValues as readonly unknown[]).includes(value);

/** Both sides submitted, one, or none. */
export function participantProgress(
  self: RequestState,
  manager: RequestState,
): Progress {
  const submitted =
    Number(self === "submitted") + Number(manager === "submitted");
  return submitted === 2 ? "complete" : submitted === 1 ? "partial" : "pending";
}
