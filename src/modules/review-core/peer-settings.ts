// Drizzle-free: shared by the schema, domain code and client components.

export const nominationStatuses = [
  "pending",
  "approved",
  "declined",
  "removed",
] as const;
export type NominationStatus = (typeof nominationStatuses)[number];

export const peerApprovals = ["manager", "none"] as const;
export type PeerApproval = (typeof peerApprovals)[number];

/** Peer settings of a cycle (components.peerSettings), locked after launch. */
export type PeerSettings = {
  maxNominations: number;
  approval: PeerApproval;
  /** Open requests from which a person shows a load warning. */
  loadWarningAt: number;
};

export const DEFAULT_PEER_SETTINGS: PeerSettings = {
  maxNominations: 5,
  approval: "manager",
  loadWarningAt: 5,
};

export const peerSettingsOf = (c: {
  peerSettings?: Partial<PeerSettings>;
}): PeerSettings => ({ ...DEFAULT_PEER_SETTINGS, ...c.peerSettings });
