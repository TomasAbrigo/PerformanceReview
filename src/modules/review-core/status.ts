import type { PeerSettings } from "./peer-settings";

/**
 * Cycle status machine (docs/research/06): the phases of a cycle depend on
 * its components (no nominations without peers, no calibration phase when
 * calibration is off, no manager review without managers). From any active phase a cycle may move one step
 * forward or one step back; `draft` is left only by launching, and `closed`
 * is terminal.
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
  /** #14: nominations cap, approval and load warning (defaults apply). */
  peerSettings?: Partial<PeerSettings>;
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

export const scheduleKinds = ["fixed", "hire_date"] as const;
export type ScheduleKind = (typeof scheduleKinds)[number];

export function phasesFor(components: CycleComponents): CycleStatus[] {
  return cycleStatuses.filter(
    (s) =>
      (s !== "nominations" || components.peer) &&
      (s !== "manager_review" || components.manager) &&
      (s !== "calibration" || components.calibration),
  );
}

/** Statuses reachable from `from`: next phase first, then the previous one. */
export function allowedTransitions(
  components: CycleComponents,
  from: CycleStatus,
): CycleStatus[] {
  if (from === "draft" || from === "closed") return [];
  const phases = phasesFor(components);
  const i = phases.indexOf(from);
  if (i < 0) return [];
  const result: CycleStatus[] = [];
  if (i + 1 < phases.length) result.push(phases[i + 1]);
  if (i - 1 > 0) result.push(phases[i - 1]);
  return result;
}

export function canTransition(
  components: CycleComponents,
  from: CycleStatus,
  to: CycleStatus,
): boolean {
  return allowedTransitions(components, from).includes(to);
}

/** First active phase after launching a draft. */
export function launchStatus(components: CycleComponents): CycleStatus {
  return phasesFor(components)[1];
}
