// Pure and server-free: what a drill-down asks for, as it rides in the URL.
//
// A drill is "the data behind" one chart mark or KPI. It lives in the
// `drill` search param (e.g. `?drill=indicator:retention:2`), so it works
// with Server Components, can be shared and is testable: the page parses it
// with `parseDrill`, reads the records with `drillRecords` (modules/insights/
// drill.ts, which applies authz.ts and the minimum group size) and renders
// them in a side sheet (components/drill). To add a kind: extend `Drill`,
// `parseDrill` / `formatDrill` here and add its reader in drill.ts.
import {
  type Band,
  bands,
  indicators,
} from "@/modules/analytics/indicators/types";
import type { Indicator } from "@/modules/analytics/indicators/types";
import {
  type Sentiment,
  sentiments,
} from "@/modules/qualitative-analysis/constants";

export const DRILL_PARAM = "drill";

export const completionSides = ["self", "manager"] as const;
export const completionStates = ["submitted", "pending"] as const;
export const goalStates = ["all", "completed", "overdue"] as const;

export type Drill =
  /** People whose manager answered `value` (1-5; null: any) to the indicator. */
  | { kind: "indicator"; indicator: Indicator; value: number | null }
  /** People in one cell of the risk matrix. */
  | { kind: "risk"; retention: Band; engagement: Band }
  /** Comments labelled with a theme. */
  | { kind: "theme"; theme: string }
  /** Comments of a dimension with a sentiment. */
  | { kind: "sentiment"; dimension: string; sentiment: Sentiment }
  /** Participants whose self / manager side is submitted or pending. */
  | {
      kind: "completion";
      side: (typeof completionSides)[number];
      state: (typeof completionStates)[number];
    }
  /** People with goals in the period (any, completed, overdue). */
  | { kind: "goals"; state: (typeof goalStates)[number] };

export type DrillKind = Drill["kind"];

/** A key of the vocabulary (theme, dimension): letters, digits, _ and -. */
const KEY = /^[\p{L}\p{N}_-]{1,64}$/u;
const isOneOf = <T extends string>(list: readonly T[], v: string): v is T =>
  (list as readonly string[]).includes(v);

/** The drill a search param asks for; null when absent or malformed. */
export function parseDrill(raw: unknown): Drill | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  const [kind, ...args] = raw.split(":");
  const [a = "", b = ""] = args;
  switch (kind) {
    case "indicator": {
      if (args.length === 1) {
        return isOneOf(indicators, a)
          ? { kind, indicator: a, value: null }
          : null;
      }
      const value = Number(b);
      return args.length === 2 &&
        isOneOf(indicators, a) &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 5
        ? { kind, indicator: a, value }
        : null;
    }
    case "risk":
      return args.length === 2 && isOneOf(bands, a) && isOneOf(bands, b)
        ? { kind, retention: a, engagement: b }
        : null;
    case "theme":
      return args.length === 1 && KEY.test(a) ? { kind, theme: a } : null;
    case "sentiment":
      return args.length === 2 && KEY.test(a) && isOneOf(sentiments, b)
        ? { kind, dimension: a, sentiment: b }
        : null;
    case "completion":
      return args.length === 2 &&
        isOneOf(completionSides, a) &&
        isOneOf(completionStates, b)
        ? { kind, side: a, state: b }
        : null;
    case "goals":
      return args.length === 1 && isOneOf(goalStates, a)
        ? { kind, state: a }
        : null;
    default:
      return null;
  }
}

/** The search-param value of a drill (the inverse of `parseDrill`). */
export function formatDrill(d: Drill): string {
  switch (d.kind) {
    case "indicator":
      return d.value === null
        ? `indicator:${d.indicator}`
        : `indicator:${d.indicator}:${d.value}`;
    case "risk":
      return `risk:${d.retention}:${d.engagement}`;
    case "theme":
      return `theme:${d.theme}`;
    case "sentiment":
      return `sentiment:${d.dimension}:${d.sentiment}`;
    case "completion":
      return `completion:${d.side}:${d.state}`;
    case "goals":
      return `goals:${d.state}`;
  }
}

/** One group of a drill's breakdown (an area, a sentiment). */
export type DrillGroup = {
  /** The group's key (area name, sentiment); null for "no area". */
  key: string | null;
  /** The groups under the minimum folded together (direction). */
  others: boolean;
  n: number;
};

/**
 * Counts per group of some records, masked for direction (`min` set): groups
 * under the minimum are folded into "others", hidden when that is still
 * under it, and the total only shows when nothing is hidden (it would give a
 * hidden group away by difference) and it reaches the minimum itself.
 * People and managers (`min` null) get every group. Largest groups first.
 */
export function maskBreakdown(
  keys: readonly (string | null)[],
  min: number | null,
): { total: number | null; groups: DrillGroup[] } {
  const counts = new Map<string | null, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  const all = [...counts]
    .map(([key, n]) => ({ key, others: false, n }))
    .sort(
      (a, b) =>
        b.n - a.n || String(a.key ?? "").localeCompare(String(b.key ?? "")),
    );
  if (min === null) return { total: keys.length, groups: all };
  if (keys.length < min) return { total: null, groups: [] };
  const shown = all.filter((g) => g.n >= min);
  const folded = all.filter((g) => g.n < min).reduce((n, g) => n + g.n, 0);
  if (folded === 0) return { total: keys.length, groups: shown };
  if (folded >= min) {
    return {
      total: keys.length,
      groups: [...shown, { key: null, others: true, n: folded }],
    };
  }
  return { total: null, groups: shown };
}
