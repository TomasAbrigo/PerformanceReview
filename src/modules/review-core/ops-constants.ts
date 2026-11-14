// Drizzle-free constants of the cycle operations (#17), shared by the schema,
// the domain and client components.

/** Administrative actions that write one admin_audit_log row each. */
export const adminActions = [
  "participant_added",
  "participant_removed",
  "due_date_extended",
  "request_unlocked",
  "completed_on_behalf",
  "assessor_assigned",
] as const;
export type AdminAction = (typeof adminActions)[number];

/** What an audit row points at (target_id is a row of that table). */
export const adminTargetTypes = ["cycle", "participant", "request"] as const;
export type AdminTargetType = (typeof adminTargetTypes)[number];

/** replace: the manager request moves to the assessor; additional: a second one. */
export const assessorModes = ["replace", "additional"] as const;
export type AssessorMode = (typeof assessorModes)[number];

/** JSON stored in admin_audit_log.before / after. */
export type AuditSnapshot = Record<string, unknown>;
