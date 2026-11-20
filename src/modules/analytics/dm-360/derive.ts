// Pure and server-free: the DM cards out of the rows the queries load (see
// queries.ts). No database, no actor: who reads what is decided before, and
// the minimum group size (`null`: nothing is masked) is the only masking here.
import type { GroupKeyer } from "@/modules/org-attributes/kinds";
import type { SideStatus } from "@/modules/analytics/completion/types";
import { likertTone, percentTone } from "@/modules/insights/tone";
import {
  type Dm360,
  type Dm360Card,
  type Dm360Point,
  type Dm360Scope,
  type Dm360Thresholds,
  type Insight360,
  MIN_COMMENTS,
  MIN_RISK_PEOPLE,
  type Mean,
  SPARK_CYCLES,
} from "./types";

export type Dm360Participant = {
  participantId: string;
  personId: string;
  cycleId: string;
  /** The DM as the org attributes file wrote them as of the snapshot; null: none. */
  dm: string | null;
};

export type Dm360Cycle = {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  /** Epoch seconds: the last tie-break of the order of cycles. */
  createdAt: number;
};

/** What is known about each participant (by participant id). */
export type Dm360Facts = {
  retention: ReadonlyMap<string, number>;
  engagement: ReadonlyMap<string, number>;
  sides: ReadonlyMap<string, { self: SideStatus; manager: SideStatus }>;
  /** Participants with a read answer: whether any carries a signal (#129). */
  signals: ReadonlyMap<string, boolean>;
};

export type Dm360Input = {
  cycles: readonly Dm360Cycle[];
  cycleId: string;
  /** Every participant the reader may count, in every cycle. */
  participants: readonly Dm360Participant[];
  scope: Dm360Scope;
  /**
   * `tree`: the participants below each DM in the organization chart (each as
   * of their own snapshot date), by `treeKey(cycleId, dm)`; the DMs that
   * resolve to nobody have none.
   */
  below?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Only these DMs get a card (a manager reads their own); null: all of them. */
  dms?: ReadonlySet<string> | null;
  facts: Dm360Facts;
  thresholds: Dm360Thresholds;
  /** Direction's minimum group size; null when nothing is masked. */
  minGroupSize: number | null;
  /** The opaque key of a DM's name: required with a minimum (direction never gets a name). */
  keyOf?: GroupKeyer;
};

export const treeKey = (cycleId: string, dm: string) => `${cycleId}\u0000${dm}`;

/** Total order of cycles: period, end of period, creation, id. */
export const byCycleOrder = (a: Dm360Cycle, b: Dm360Cycle) =>
  a.periodStart.localeCompare(b.periodStart) ||
  a.periodEnd.localeCompare(b.periodEnd) ||
  a.createdAt - b.createdAt ||
  a.id.localeCompare(b.id);

const collator = new Intl.Collator("es");

const mean = (values: readonly number[]): Mean | null =>
  values.length
    ? {
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        n: values.length,
      }
    : null;

/** A figure over `n` people, or nothing when direction may not see it. */
const visible = <T>(value: T, n: number, min: number | null): T | null =>
  min !== null && n < min ? null : value;

type Metrics = Omit<
  Dm360Card,
  "key" | "label" | "others" | "trend" | "insights"
>;

/** The figures of some participants of one cycle. */
function metricsOf(
  members: readonly Dm360Participant[],
  facts: Dm360Facts,
  thresholds: Dm360Thresholds,
  min: number | null,
): Metrics {
  const retentions: number[] = [];
  const engagements: number[] = [];
  let withBoth = 0;
  let atRisk = 0;
  const side = { self: [0, 0], manager: [0, 0] };
  let readers = 0;
  let flagged = 0;
  for (const m of members) {
    const r = facts.retention.get(m.participantId);
    const e = facts.engagement.get(m.participantId);
    if (r !== undefined) retentions.push(r);
    if (e !== undefined) engagements.push(e);
    if (r !== undefined && e !== undefined) {
      withBoth += 1;
      if (r <= thresholds.riskThreshold && e <= thresholds.riskThreshold) {
        atRisk += 1;
      }
    }
    const s = facts.sides.get(m.participantId);
    for (const who of ["self", "manager"] as const) {
      const status = s?.[who];
      if (!status || status === "not_applicable") continue;
      side[who][1] += 1;
      if (status === "submitted") side[who][0] += 1;
    }
    const has = facts.signals.get(m.participantId);
    if (has !== undefined) {
      readers += 1;
      if (has) flagged += 1;
    }
  }
  const rate = ([done, of]: number[]) =>
    of > 0 ? visible(done / of, of, min) : null;
  const signals =
    readers > 0
      ? visible(
          { people: flagged, of: readers, share: flagged / readers },
          readers,
          min,
        )
      : null;
  return {
    people: members.length,
    retention: visible(mean(retentions), retentions.length, min),
    engagement: visible(mean(engagements), engagements.length, min),
    risk:
      withBoth > 0
        ? visible(
            { people: atRisk, of: withBoth, share: atRisk / withBoth },
            withBoth,
            min,
          )
        : null,
    signals,
    selfRate: rate(side.self),
    managerRate: rate(side.manager),
  };
}

const rounded = (n: number) => Math.round(n * 10) / 10;
const percent = (share: number) => Math.round(share * 100);

/**
 * What to say about a card, by rules: an indicator that fell by the drop
 * threshold or more since the last cycle that had a mean, a negative share of
 * the comments, a high share of people at risk, the manager assessments still
 * pending; "stable" when none applies and there is something to judge by.
 * Most urgent first. The numbers are the card's own, so masked figures never
 * make a sentence.
 */
export function insightsOf(
  card: Pick<
    Dm360Card,
    "retention" | "engagement" | "risk" | "signals" | "managerRate" | "trend"
  >,
  thresholds: Dm360Thresholds,
): Insight360[] {
  const out: Insight360[] = [];
  const points = card.trend;
  const current = points[points.length - 1];
  // #133: a fall is measured only against the cycle right before.
  const before = points[points.length - 2];
  for (const indicator of ["retention", "engagement"] as const) {
    const now = card[indicator]?.mean;
    if (now === undefined || !current) continue;
    const previous = before?.[indicator];
    if (
      before &&
      previous != null &&
      previous - now >= thresholds.dropThreshold
    ) {
      out.push({
        code: indicator === "retention" ? "retentionDrop" : "engagementDrop",
        params: {
          previous: rounded(previous),
          current: rounded(now),
          delta: rounded(previous - now),
          cycle: before.cycleName,
        },
      });
    }
  }
  // #133: one definition of "alert", the tone the card's own KPI shows (the
  // `targets.*` settings): anything not "good" is said.
  const attention = (pct: number, better: "up" | "down" = "up") =>
    percentTone(pct, thresholds, better) !== "good";
  const s = card.signals;
  if (s && s.of >= MIN_COMMENTS && attention(percent(s.share), "down")) {
    out.push({
      code: "signals",
      params: { percent: percent(s.share), people: s.people, of: s.of },
    });
  }
  const r = card.risk;
  if (
    r &&
    r.of >= MIN_RISK_PEOPLE &&
    r.people > 0 &&
    attention(percent(r.share), "down")
  ) {
    out.push({
      code: "riskHigh",
      params: { percent: percent(r.share), people: r.people },
    });
  }
  if (card.managerRate !== null && attention(percent(card.managerRate))) {
    out.push({
      code: "completionLow",
      params: { percent: percent(card.managerRate) },
    });
  }
  if (out.length > 0) return out;
  // Not an alert, but never "stable" while a mean is short of its target.
  const below = (m: Mean | null) =>
    m !== null && likertTone(m.mean, thresholds.riskThreshold) !== "good"
      ? 1
      : 0;
  const retention = below(card.retention);
  const engagement = below(card.engagement);
  if (retention + engagement > 0)
    return [{ code: "belowTarget", params: { retention, engagement } }];
  const judged = card.retention || card.engagement || card.risk || card.signals;
  return [judged ? { code: "stable" } : { code: "noData" }];
}

/**
 * The DM cards of a cycle (`input.cycleId`) and their evolution cycle by
 * cycle. A DM's people in a cycle are those whose DM attribute names them
 * (`direct`) plus, with `tree`, everybody below them in the chart. With a
 * minimum (direction) a card keeps its key but not the DM's name, DMs under
 * it are folded into "Otros" (dropped if that is still under it, and counted
 * in `suppressed`), and a figure over fewer people than that is left out.
 */
export function buildDm360(input: Dm360Input): Omit<Dm360, "cycleName"> {
  const { facts, thresholds, minGroupSize: min } = input;
  const ordered = [...input.cycles].sort(byCycleOrder);
  const at = ordered.findIndex((c) => c.id === input.cycleId);
  const shown = ordered.slice(Math.max(0, at + 1 - SPARK_CYCLES), at + 1);

  const byCycle = new Map<string, Dm360Participant[]>();
  for (const p of input.participants) {
    const list = byCycle.get(p.cycleId) ?? [];
    list.push(p);
    byCycle.set(p.cycleId, list);
  }
  const membersOf = (cycleId: string, dm: string) =>
    (byCycle.get(cycleId) ?? []).filter(
      (p) =>
        p.dm === dm ||
        (input.scope === "tree" &&
          input.below?.get(treeKey(cycleId, dm))?.has(p.participantId) ===
            true),
    );

  const inCycle = byCycle.get(input.cycleId) ?? [];
  const names = [
    ...new Set(inCycle.flatMap((p) => (p.dm ? [p.dm] : []))),
  ].filter((dm) => !input.dms || input.dms.has(dm));

  type Group = { dm: string; members: (cycleId: string) => Dm360Participant[] };
  const groups: Group[] = names.map((dm) => ({
    dm,
    members: (cycleId) => membersOf(cycleId, dm),
  }));

  const cardOf = (
    key: string,
    label: string | null,
    others: boolean,
    members: (cycleId: string) => Dm360Participant[],
  ): Dm360Card => {
    const now = metricsOf(members(input.cycleId), facts, thresholds, min);
    const trend = shown.map((c): Dm360Point => {
      const m = metricsOf(members(c.id), facts, thresholds, min);
      return {
        cycleId: c.id,
        cycleName: c.name,
        periodStart: c.periodStart,
        people: visible(m.people, m.people, min),
        retention: m.retention?.mean ?? null,
        engagement: m.engagement?.mean ?? null,
      };
    });
    const card = { ...now, trend };
    return {
      key,
      label,
      others,
      ...card,
      insights: insightsOf(card, thresholds),
    };
  };

  const sizeOf = (g: Group) => g.members(input.cycleId).length;
  const withoutDm = inCycle.filter((p) => !p.dm).length;
  if (min === null) {
    const cards = groups
      .map((g) => cardOf(g.dm, g.dm, false, g.members))
      .sort(
        (a, b) =>
          collator.compare(a.label ?? "", b.label ?? "") ||
          a.key.localeCompare(b.key),
      );
    return {
      cycleId: input.cycleId,
      scope: input.scope,
      minGroupSize: null,
      thresholds,
      cards,
      withoutDm,
      suppressed: 0,
    };
  }

  const keyOf = input.keyOf;
  if (!keyOf) throw new Error("Masked DM cards need a group keyer");
  const big = groups.filter((g) => sizeOf(g) >= min);
  const small = groups.filter((g) => sizeOf(g) < min);
  const cards = big
    .map((g) => cardOf(keyOf(g.dm), null, false, g.members))
    .sort((a, b) => b.people - a.people || a.key.localeCompare(b.key));
  let suppressed = 0;
  if (small.length > 0) {
    // The people of the small DMs together (a person once, whatever the DMs).
    const together = (cycleId: string) => {
      const seen = new Set<string>();
      return small
        .flatMap((g) => g.members(cycleId))
        .filter((p) => !seen.has(p.participantId) && seen.add(p.participantId));
    };
    const others = cardOf("others", null, true, together);
    if (others.people >= min) cards.push(others);
    else suppressed = others.people;
  }
  return {
    cycleId: input.cycleId,
    scope: input.scope,
    minGroupSize: min,
    thresholds,
    cards,
    withoutDm: null,
    suppressed,
  };
}
