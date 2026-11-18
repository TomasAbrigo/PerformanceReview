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

/**
 * Where a participant stands for the actor: both sides submitted, one, or
 * none, counting only what the actor may read. Worked out in SQL
 * (`progressSql` in queries.ts) so the counts and pages come from the
 * database.
 */
export const progressValues = ["complete", "partial", "pending"] as const;
export type Progress = (typeof progressValues)[number];

export const isProgressFilter = (value: unknown): value is Progress =>
  (progressValues as readonly unknown[]).includes(value);
