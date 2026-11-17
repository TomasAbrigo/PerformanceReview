// Pure and server-free: from the standing of each participant to the numbers
// the views show. The queries load the rows once (see `loadSides`), and the
// summary and the "quién falta" list are both read off the same rows.
import { foldSmallGroups } from "@/modules/insights/aggregation";
import {
  type CompletionCounts,
  type CompletionGroupBy,
  type CompletionSource,
  type CompletionSummary,
  isMissing,
  type MissingStatus,
  type SideStatus,
  withRates,
} from "./types";

/** One participant of a cycle with the standing of both sides of their assessment. */
export type SideRow = {
  participantId: string;
  personId: string;
  name: string;
  department: string | null;
  managerId: string | null;
  managerName: string | null;
  source: CompletionSource;
  selfStatus: SideStatus;
  managerStatus: SideStatus;
  hasNotes: boolean;
  /** Only when the query was asked for it. */
  email?: string | null;
};

const NONE: CompletionCounts = {
  participants: 0,
  selfSubmitted: 0,
  selfApplicable: 0,
  managerSubmitted: 0,
  managerApplicable: 0,
};

/** The counts of some participants (a side that does not apply is out of the rates). */
export function countsOf(rows: readonly SideRow[]): CompletionCounts {
  return rows.reduce(
    (c, r) => ({
      participants: c.participants + 1,
      selfSubmitted: c.selfSubmitted + (r.selfStatus === "submitted" ? 1 : 0),
      selfApplicable:
        c.selfApplicable + (r.selfStatus === "not_applicable" ? 0 : 1),
      managerSubmitted:
        c.managerSubmitted + (r.managerStatus === "submitted" ? 1 : 0),
      managerApplicable:
        c.managerApplicable + (r.managerStatus === "not_applicable" ? 0 : 1),
    }),
    NONE,
  );
}

type Keyed = { key: string | null; label: string | null; rows: SideRow[] };

const collator = new Intl.Collator("es");

/** Groups by department or manager, named ones in order and the unassigned one last. */
function groupRows(
  rows: readonly SideRow[],
  groupBy: "department" | "manager",
) {
  const groups = new Map<string, Keyed>();
  for (const r of rows) {
    const key = groupBy === "department" ? r.department : r.managerId;
    const label = groupBy === "department" ? r.department : r.managerName;
    const id = key ?? "";
    const group = groups.get(id) ?? { key, label, rows: [] };
    group.rows.push(r);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.label === null || b.label === null
      ? Number(a.label === null) - Number(b.label === null)
      : collator.compare(a.label, b.label) ||
        (a.key ?? "").localeCompare(b.key ?? ""),
  );
}

/** The counts a folded group carries as the bins of a GroupCell. */
const toBins = (c: CompletionCounts) => [
  c.selfSubmitted,
  c.selfApplicable,
  c.managerSubmitted,
  c.managerApplicable,
];
const fromBins = (n: number, bins: number[]): CompletionCounts => ({
  participants: n,
  selfSubmitted: bins[0],
  selfApplicable: bins[1],
  managerSubmitted: bins[2],
  managerApplicable: bins[3],
});

type Summary = Omit<CompletionSummary, "cycleId" | "cycleName" | "hierarchy">;

/**
 * The summary of a cycle's participants. `minGroupSize` null: nothing is
 * masked (People, a manager). A number (direction): groups under it, and the
 * unassigned one, are folded into "Otros" (hidden if that is under it too),
 * and with fewer participants than that only the head count is given. A
 * manager is a person: grouped by manager, direction's teams keep their key
 * (to tell them apart) but have no label.
 */
export function summarize(
  rows: readonly SideRow[],
  {
    groupBy,
    minGroupSize,
  }: { groupBy: CompletionGroupBy; minGroupSize: number | null },
): Summary {
  const all = countsOf(rows);
  const fromProgress = rows.filter((r) => r.source === "progress").length;
  const base = { groupBy, participants: all.participants };
  const sources = {
    progress: fromProgress,
    requests: all.participants - fromProgress,
  };
  const groups =
    groupBy === "none"
      ? []
      : groupRows(rows, groupBy).map((g) => ({
          ...g,
          counts: countsOf(g.rows),
        }));

  if (minGroupSize === null) {
    return {
      ...base,
      minGroupSize: null,
      total: withRates(null, null, all),
      groups: groups.map((g) => withRates(g.key, g.label, g.counts)),
      others: null,
      suppressed: 0,
      sources,
    };
  }
  if (all.participants < minGroupSize) {
    return {
      ...base,
      minGroupSize,
      total: null,
      groups: [],
      others: null,
      suppressed: all.participants,
      sources: { progress: 0, requests: 0 },
    };
  }
  const folded = foldSmallGroups(
    groups.map((g) => ({
      key: g.key,
      label: g.label,
      n: g.counts.participants,
      mean: null,
      counts: toBins(g.counts),
    })),
    minGroupSize,
  );
  return {
    ...base,
    minGroupSize,
    total: withRates(null, null, all),
    groups: folded.shown.map((g) =>
      withRates(
        g.key,
        groupBy === "manager" ? null : g.label,
        fromBins(g.n, g.counts),
      ),
    ),
    others: folded.others
      ? withRates(null, null, fromBins(folded.others.n, folded.others.counts))
      : null,
    suppressed: folded.suppressed,
    sources,
  };
}

/** The participants with a side still to be submitted (in the order they came). */
export function missingOf(
  rows: readonly SideRow[],
  status: MissingStatus = "any",
): SideRow[] {
  return rows.filter((r) => {
    const self = isMissing(r.selfStatus);
    const manager = isMissing(r.managerStatus);
    return status === "self_missing"
      ? self
      : status === "manager_missing"
        ? manager
        : self || manager;
  });
}
