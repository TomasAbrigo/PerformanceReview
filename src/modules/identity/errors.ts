export type IdentityErrorCode =
  | "not_found"
  | "person_required"
  | "invalid_action"
  | "invalid_payload"
  | "already_resolved"
  | "already_applied";

export class IdentityError extends Error {
  constructor(readonly code: IdentityErrorCode) {
    super(code);
    this.name = "IdentityError";
  }
}
