/**
 * Phases a cycle went through in the review flow that this app no longer
 * runs (#54): kept as the cycle_status enum, since cycles carry them as data
 * (imported cycles are `closed`).
 */
export const cycleStatuses = [
  "draft",
  "nominations",
  "collecting",
  "manager_review",
  "calibration",
  "sharing",
  "closed",
] as const;
export type CycleStatus = (typeof cycleStatuses)[number];

export const anonymityModes = [
  "transparent",
  "anonymous_to_employee",
  "fully_anonymous",
] as const;
export type AnonymityMode = (typeof anonymityModes)[number];

export type CycleComponents = {
  self: boolean;
  manager: boolean;
  peer: boolean;
  upward: boolean;
  calibration: boolean;
  /**
   * Manager/self double blind: neither sees the other's review until both
   * are submitted (manager) / it is shared (employee). Missing = on.
   */
  doubleBlind?: boolean;
  /** Peer settings of the removed nominations flow (#14), kept as data. */
  peerSettings?: Record<string, unknown>;
};

export const isDoubleBlind = (c: Pick<CycleComponents, "doubleBlind">) =>
  c.doubleBlind !== false;

export type CycleAnonymity = { peer: AnonymityMode; upward: AnonymityMode };

/** Due date (ISO) per phase; omitted phases have no deadline. */
export const dueDatePhases = [
  "nominations",
  "self",
  "peer",
  "manager",
  "calibration",
  "sharing",
  "acknowledge",
] as const;
export type DueDatePhase = (typeof dueDatePhases)[number];
export type CycleDueDates = Partial<Record<DueDatePhase, string>>;
