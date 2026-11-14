// Drizzle-free constants shared by the schema, the domain and client components.

/**
 * `superseded`: a submitted manager review replaced by another assessor's
 * request (#17); kept for history, never written or read as current.
 */
export const requestStatuses = [
  "draft",
  "submitted",
  "declined",
  "superseded",
] as const;
export type RequestStatus = (typeof requestStatuses)[number];

export const reviewActions = [
  "unlock",
  "shared",
  "unshared",
  "reminder_sent",
  "reviewer_reassigned",
  "calibration_published",
  "rating_override",
] as const;
export type ReviewAction = (typeof reviewActions)[number];
