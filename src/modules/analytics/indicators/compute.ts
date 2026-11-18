// Pure: the indicator figures out of the rows `loadRows` reads. No database,
// no actor: the callers decide who reads what (see queries.ts).
import { foldSmallGroups } from "@/modules/insights";
import {
  type GroupKeyer,
  groupIdentity,
  orgDimOf,
  orgOptionsOf,
} from "@/modules/org-attributes/kinds";
import type { IndicatorRow } from "./rows";
import {
  type AlertPerson,
  bandOf,
  bands,
  type Indicator,
  type IndicatorAlert,
  type IndicatorAlerts,
  type IndicatorConfig,
  type IndicatorDistribution,
  type IndicatorFilters,
  type IndicatorGroupBy,
  type IndicatorSeries,
  type IndicatorTrend,
  type MatrixCell,
  type RiskMatrix,
  type RiskPerson,
  type TrendPoint,
  type TrendSubject,
  VALUE_COUNT,
} from "./types";

/** How the reader sees people: all of them, a manager's reports, or aggregates only. */
export type Reach = "all" | "directReports" | "aggregatesOnly";

const emptyCounts = () => Array<number>(VALUE_COUNT).fill(0);

/** The count of each value (index 0 = value 1), their n and mean. */
function seriesOf(
  counts: number[],
  key: string | null,
  label: string | null,
  others = false,
): IndicatorSeries {
  const n = counts.reduce((a, b) => a + b, 0);
  const sum = counts.reduce((a, c, i) => a + c * (i + 1), 0);
  return { key, label, others, counts, n, mean: n ? sum / n : null };
}

export function matches(row: IndicatorRow, filters: IndicatorFilters = {}) {
  return (
    (!filters.department || row.department === filters.department) &&
    (!filters.managerId || row.managerId === filters.managerId) &&
    (!filters.account || row.account === filters.account) &&
    (!filters.project || row.project === filters.project) &&
    (!filters.dm || row.dm === filters.dm) &&
    (!filters.santexLead || row.santexLead === filters.santexLead)
  );
}

/**
 * The order of cycles: by period, then end of period, then when they were
 * created, then id. A total order: two cycles of the same period still have
 * a before and an after, so "the previous cycle" is always well defined.
 */
export function compareCycles(
  a: Pick<
    IndicatorRow,
    "periodStart" | "periodEnd" | "cycleCreatedAt" | "cycleId"
  >,
  b: typeof a,
): number {
  return (
    a.periodStart.localeCompare(b.periodStart) ||
    a.periodEnd.localeCompare(b.periodEnd) ||
    a.cycleCreatedAt - b.cycleCreatedAt ||
    a.cycleId.localeCompare(b.cycleId)
  );
}

/** Collator order of the labels, the unlabelled last. */
const byLabel = (a: IndicatorSeries, b: IndicatorSeries) =>
  a.label === null || b.label === null
    ? Number(a.label === null) - Number(b.label === null)
    : a.label.localeCompare(b.label, "es") ||
      (a.key ?? "").localeCompare(b.key ?? "");

// ------------------------------------------------------------ distribution

/**
 * Distribution of one indicator over `rows` (the filtered rows of one cycle):
 * counts per value 1-5, n and mean, per area or manager or all together.
 * Direction (`minGroupSize`) only gets groups of at least that many people:
 * the smaller ones (and people without a group) fold into "others" when that
 * is itself big enough, and are hidden otherwise; the total goes with them
 * when anything is hidden, since it would give a hidden group away. A DM or
 * Santex Lead is a person: direction gets their team under the opaque key
 * `keyOf` makes of the name, never the name.
 */
export function buildDistribution(
  rows: IndicatorRow[],
  input: { cycleId: string; indicator: Indicator; groupBy: IndicatorGroupBy },
  minGroupSize: number | null,
  keyOf?: GroupKeyer,
): IndicatorDistribution {
  const groups = new Map<
    string,
    { key: string | null; label: string | null; counts: number[] }
  >();
  const all = emptyCounts();
  for (const r of rows) {
    if (r.indicator !== input.indicator) continue;
    const { key, label } =
      input.groupBy === "department"
        ? { key: r.department, label: r.department }
        : input.groupBy === "manager"
          ? { key: r.managerId, label: r.managerName }
          : input.groupBy === "none"
            ? { key: null, label: null }
            : // Direction reads the teams of a DM or Santex Lead, not their names.
              groupIdentity(
                input.groupBy,
                orgDimOf(r, input.groupBy),
                minGroupSize !== null,
                keyOf,
              );
    const g = groups.get(key ?? "") ?? { key, label, counts: emptyCounts() };
    g.counts[r.value - 1]++;
    all[r.value - 1]++;
    groups.set(key ?? "", g);
  }
  const total = seriesOf(all, null, null);
  const base = {
    cycleId: input.cycleId,
    indicator: input.indicator,
    groupBy: input.groupBy,
  };
  const named = [...groups.values()]
    .map((g) => seriesOf(g.counts, g.key, g.label))
    .sort(byLabel);
  const grouped = input.groupBy !== "none";
  if (minGroupSize === null) {
    return {
      ...base,
      series: grouped ? named : total.n ? [total] : [],
      total,
      suppressed: 0,
      minGroupSize: null,
    };
  }
  if (!grouped) {
    const visible = total.n >= minGroupSize;
    return {
      ...base,
      series: visible ? [total] : [],
      total: visible ? total : null,
      suppressed: visible ? 0 : total.n,
      minGroupSize,
    };
  }
  const folded = foldSmallGroups(named, minGroupSize);
  return {
    ...base,
    series: [
      ...folded.shown,
      ...(folded.others
        ? [seriesOf(folded.others.counts, null, null, true)]
        : []),
    ],
    total: folded.suppressed === 0 && total.n >= minGroupSize ? total : null,
    suppressed: folded.suppressed,
    minGroupSize,
  };
}

// ------------------------------------------------------------------- trend

/**
 * One indicator cycle by cycle (in the order of cycles) over `rows`, the
 * rows of the subject. Cycles direction cannot see (under `minGroupSize`)
 * are kept as suppressed points.
 */
export function buildTrend(
  rows: IndicatorRow[],
  indicator: Indicator,
  subject: TrendSubject,
  minGroupSize: number | null,
): IndicatorTrend {
  const cycles = new Map<string, { row: IndicatorRow; counts: number[] }>();
  for (const r of rows) {
    if (r.indicator !== indicator) continue;
    const c = cycles.get(r.cycleId) ?? { row: r, counts: emptyCounts() };
    c.counts[r.value - 1]++;
    cycles.set(r.cycleId, c);
  }
  const points: TrendPoint[] = [...cycles.values()]
    .sort((a, b) => compareCycles(a.row, b.row))
    .map(({ row, counts }) => {
      const s = seriesOf(counts, null, null);
      const hidden = minGroupSize !== null && s.n < minGroupSize;
      return {
        cycleId: row.cycleId,
        cycleName: row.cycleName,
        periodStart: row.periodStart,
        n: hidden ? null : s.n,
        mean: hidden ? null : s.mean,
        counts: hidden ? null : s.counts,
        suppressed: hidden,
      };
    });
  return { indicator, subject, points, minGroupSize };
}

// ------------------------------------------------------------- risk matrix

/** Both indicators of the participants who have both. */
function pairsOf(rows: IndicatorRow[]) {
  const pairs = new Map<
    string,
    { row: IndicatorRow; retention?: number; engagement?: number }
  >();
  for (const r of rows) {
    const p = pairs.get(r.participantId) ?? { row: r };
    p[r.indicator] = r.value;
    pairs.set(r.participantId, p);
  }
  return [...pairs.values()].flatMap((p) =>
    p.retention !== undefined && p.engagement !== undefined
      ? [{ row: p.row, retention: p.retention, engagement: p.engagement }]
      : [],
  );
}

/**
 * Retention × engagement of one cycle's rows in three bands per axis; the
 * cell with both low is the risk quadrant. Those who may name people get the
 * list of who is in it; direction gets cells of at least `minGroupSize` and
 * the total only when no cell is hidden.
 */
export function buildMatrix(
  rows: IndicatorRow[],
  cycleId: string,
  config: IndicatorConfig,
  reach: Reach,
): RiskMatrix {
  const pairs = pairsOf(rows);
  const counts = new Map<string, number>();
  const atRisk: RiskPerson[] = [];
  for (const { row, retention, engagement } of pairs) {
    const r = bandOf(retention, config.riskThreshold);
    const e = bandOf(engagement, config.riskThreshold);
    counts.set(`${r}:${e}`, (counts.get(`${r}:${e}`) ?? 0) + 1);
    if (r === "low" && e === "low") {
      atRisk.push({
        personId: row.personId,
        name: row.name,
        managerId: row.managerId,
        managerName: row.managerName,
        department: row.department,
        retention,
        engagement,
      });
    }
  }
  atRisk.sort(
    (a, b) =>
      a.retention + a.engagement - (b.retention + b.engagement) ||
      a.name.localeCompare(b.name, "es"),
  );
  const min = reach === "aggregatesOnly" ? config.minGroupSize : null;
  const cells: MatrixCell[] = bands.flatMap((retention) =>
    bands.map((engagement) => {
      const count = counts.get(`${retention}:${engagement}`) ?? 0;
      return {
        retention,
        engagement,
        count: min !== null && count > 0 && count < min ? null : count,
        risk: retention === "low" && engagement === "low",
      };
    }),
  );
  const suppressed = cells.some((c) => c.count === null);
  return {
    cycleId,
    riskThreshold: config.riskThreshold,
    cells,
    total: suppressed ? null : pairs.length,
    riskCount: cells.find((c) => c.risk)!.count,
    atRisk: reach === "aggregatesOnly" ? null : atRisk,
    suppressed,
    minGroupSize: min,
  };
}

// ------------------------------------------------------------------ alerts

const kindOrder = { risk: 0, drop: 1 } as const;

/**
 * The alerts of `cycleId` out of the rows of all cycles (the previous value
 * of a drop is the latest row of the same person and indicator that comes
 * before in the order of cycles; see `compareCycles`). Only the rows of the
 * cycle that pass `filters` can alert. Direction gets the number of people
 * (hidden under `minGroupSize`) and no alerts.
 */
export function buildAlerts(
  rows: IndicatorRow[],
  cycleId: string,
  filters: IndicatorFilters | undefined,
  config: IndicatorConfig,
  reach: Reach,
): IndicatorAlerts {
  const history = new Map<string, IndicatorRow[]>();
  for (const r of rows) {
    const key = `${r.personId}:${r.indicator}`;
    history.set(key, [...(history.get(key) ?? []), r]);
  }
  for (const list of history.values()) list.sort(compareCycles);
  const people = new Map<
    string,
    { person: AlertPerson; rows: IndicatorRow[] }
  >();
  for (const r of rows) {
    if (r.cycleId !== cycleId || !matches(r, filters)) continue;
    const p = people.get(r.personId) ?? {
      person: {
        personId: r.personId,
        name: r.name,
        managerId: r.managerId,
        managerName: r.managerName,
        department: r.department,
      },
      rows: [],
    };
    p.rows.push(r);
    people.set(r.personId, p);
  }
  const alerts: IndicatorAlert[] = [];
  let withDrop = 0;
  let atRisk = 0;
  for (const { person, rows: own } of people.values()) {
    const value = (i: Indicator) => own.find((r) => r.indicator === i)?.value;
    let dropped = false;
    for (const r of own) {
      const list = history.get(`${r.personId}:${r.indicator}`)!;
      const previous = list[list.findIndex((x) => x.cycleId === r.cycleId) - 1];
      if (!previous) continue;
      const delta = previous.value - r.value;
      if (delta < config.dropThreshold) continue;
      dropped = true;
      alerts.push({
        kind: "drop",
        indicator: r.indicator,
        person,
        previousCycleId: previous.cycleId,
        previousCycleName: previous.cycleName,
        previousValue: previous.value,
        value: r.value,
        delta,
      });
    }
    if (dropped) withDrop++;
    const retention = value("retention");
    const engagement = value("engagement");
    if (
      retention !== undefined &&
      engagement !== undefined &&
      retention <= config.riskThreshold &&
      engagement <= config.riskThreshold
    ) {
      atRisk++;
      alerts.push({ kind: "risk", person, retention, engagement });
    }
  }
  alerts.sort(
    (a, b) =>
      kindOrder[a.kind] - kindOrder[b.kind] ||
      a.person.name.localeCompare(b.person.name, "es") ||
      (a.kind === "drop" && b.kind === "drop"
        ? Number(a.indicator === "engagement") -
          Number(b.indicator === "engagement")
        : 0),
  );
  const min = reach === "aggregatesOnly" ? config.minGroupSize : null;
  const visible = (n: number) => (min !== null && n > 0 && n < min ? null : n);
  return {
    cycleId,
    dropThreshold: config.dropThreshold,
    riskThreshold: config.riskThreshold,
    peopleWithDrop: visible(withDrop),
    peopleAtRisk: visible(atRisk),
    alerts: reach === "aggregatesOnly" ? [] : alerts,
    minGroupSize: min,
  };
}

// ----------------------------------------------------------------- pickers

/**
 * Areas, managers and org attributes of `rows`, by name. `named` false
 * (direction): no DMs or Santex Leads, they are people.
 */
export function optionsOf(rows: IndicatorRow[], named = true) {
  const departments = new Set<string>();
  const managers = new Map<string, string>();
  const people = new Map<string, string>();
  for (const r of rows) {
    if (r.department) departments.add(r.department);
    if (r.managerId && r.managerName) managers.set(r.managerId, r.managerName);
    if (r.name) people.set(r.personId, r.name);
  }
  const listOf = (m: Map<string, string>) =>
    [...m]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  return {
    departments: [...departments].sort((a, b) => a.localeCompare(b, "es")),
    managers: listOf(managers),
    people: listOf(people),
    org: orgOptionsOf(rows, named),
  };
}
