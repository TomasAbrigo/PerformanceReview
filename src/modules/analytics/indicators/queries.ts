import { type SQL, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { isUuid } from "@/lib/uuid";
import type { Hierarchy } from "@/modules/analytics/dashboards/types";
import { ReviewError } from "@/modules/review-core/review-errors";
import { indicatorConfig } from "./config";
import { type IndicatorScope, requireIndicatorScope } from "./scope";
import {
  type AlertPerson,
  bandOf,
  bands,
  type IndicatorActor,
  type IndicatorAlert,
  type IndicatorAlerts,
  type IndicatorConfig,
  type IndicatorDistribution,
  type IndicatorFilters,
  type IndicatorGroupBy,
  type IndicatorSeries,
  type IndicatorTrend,
  type Indicator,
  type MatrixCell,
  type RiskMatrix,
  type RiskPerson,
  type TrendPoint,
  type TrendSubject,
  VALUE_COUNT,
} from "./types";

/** Options every query takes besides its own. */
type Common = {
  filters?: IndicatorFilters;
  /** Replaces some thresholds for this call (tests); settings otherwise. */
  config?: Partial<IndicatorConfig>;
};

const requireUuid = (id: string): string => {
  if (!isUuid(id)) throw new ReviewError("not_found");
  return id;
};

async function requireCycle(db: DbOrTx, cycleId: string): Promise<void> {
  requireUuid(cycleId);
  const found = await db.execute(
    sql`select 1 from review_cycle where id = ${cycleId}::uuid`,
  );
  if (found.length === 0) throw new ReviewError("not_found");
}

/**
 * CTEs of the indicator rows the actor may read:
 * - `base`: the active participants of launched cycles (optionally of one
 *   cycle) with their area and manager (the snapshot's, or today's), limited
 *   to the actor's reach: a manager's reach is always their direct reports of
 *   the snapshot (never themself), whatever hierarchy the view reads;
 * - `ind`: one row per participant and indicator with the value (1-5) the
 *   manager gave. The answers of the participant's submitted manager review
 *   to the question revisions with the role `retention` / `engagement`; if
 *   several reviewers submitted, the latest review counts.
 */
function indicatorCtes(
  actor: IndicatorActor,
  scope: IndicatorScope,
  f: { cycleId?: string; hierarchy: Hierarchy },
): SQL {
  const asOf = f.hierarchy === "asOf";
  const department = asOf ? sql`cp.snap_department` : sql`cur.department`;
  const manager = asOf
    ? sql`cp.snap_manager_person_id`
    : sql`cur.manager_person_id`;
  const where: SQL[] = [sql`cp.removed_at is null`, sql`c.status <> 'draft'`];
  if (f.cycleId) where.push(sql`cp.cycle_id = ${f.cycleId}::uuid`);
  if (scope === "directReports") {
    where.push(sql`cp.snap_manager_person_id = ${actor.personId}::uuid`);
    // Never about themself, even if the data names them their own manager.
    where.push(sql`cp.reviewee_person_id <> ${actor.personId}::uuid`);
  }
  return sql`
    cur as (
      select distinct on (h.person_id) h.person_id, h.manager_person_id, h.department
      from employee_job_history h
      where h.deleted_at is null and h.valid_to is null
      order by h.person_id, h.valid_from desc
    ),
    base as (
      select cp.id as participant_id, cp.cycle_id, c.name as cycle_name,
             c.period_start::text as period_start,
             cp.reviewee_person_id as person_id, rp.display_name as name,
             ${department} as department, ${manager} as manager_id,
             mp.display_name as manager_name
      from cycle_participant cp
      join review_cycle c on c.id = cp.cycle_id
      join person rp on rp.id = cp.reviewee_person_id
      ${asOf ? sql`` : sql`left join cur on cur.person_id = cp.reviewee_person_id`}
      left join person mp on mp.id = ${manager}
      where ${sql.join(where, sql` and `)}
    ),
    ind as (
      select distinct on (b.participant_id, q.role)
             b.*, q.role as indicator, a.option_value::int as value
      from base b
      join review_request r on r.participant_id = b.participant_id
        and r.relationship = 'manager' and r.status = 'submitted'
        and r.deleted_at is null
      join question_revision q on q.cycle_id = b.cycle_id
        and q.role in ('retention', 'engagement')
      join answer a on a.request_id = r.id and a.question_revision_id = q.id
        and a.option_value in (1, 2, 3, 4, 5)
      order by b.participant_id, q.role, r.submitted_at desc nulls last, r.id
    )`;
}

/** Conditions on the rows of `ind` aliased `i`: the area / manager filters. */
function filterConds(filters: IndicatorFilters = {}): SQL[] {
  const conds: SQL[] = [];
  if (filters.department) {
    conds.push(sql`i.department = ${filters.department}`);
  }
  if (filters.managerId) {
    conds.push(sql`i.manager_id = ${requireUuid(filters.managerId)}::uuid`);
  }
  return conds;
}

const andAll = (conds: SQL[]): SQL =>
  conds.length ? sql`and ${sql.join(conds, sql` and `)}` : sql``;

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

const emptyCounts = () => Array<number>(VALUE_COUNT).fill(0);

// ------------------------------------------------------------ distribution

const groupColumns: Record<IndicatorGroupBy, { key: SQL; label: SQL }> = {
  department: { key: sql`i.department`, label: sql`i.department` },
  manager: { key: sql`i.manager_id::text`, label: sql`i.manager_name` },
  none: { key: sql`null::text`, label: sql`null::text` },
};

/** Collator order of the labels, the unlabelled last. */
const byLabel = (a: IndicatorSeries, b: IndicatorSeries) =>
  a.label === null || b.label === null
    ? Number(a.label === null) - Number(b.label === null)
    : a.label.localeCompare(b.label, "es") ||
      (a.key ?? "").localeCompare(b.key ?? "");

/**
 * Direction's minimum: groups under it are folded into one "others" series
 * when that is itself big enough, and hidden otherwise.
 */
function applyMinimum(series: IndicatorSeries[], min: number) {
  const shown = series.filter((s) => s.n >= min);
  const small = series.filter((s) => s.n < min);
  const smallN = small.reduce((a, s) => a + s.n, 0);
  if (small.length > 1 && smallN >= min) {
    const counts = emptyCounts();
    for (const s of small) s.counts.forEach((c, i) => (counts[i] += c));
    shown.push(seriesOf(counts, null, null, true));
    return { series: shown, suppressed: 0 };
  }
  return { series: shown, suppressed: smallN };
}

/**
 * Distribution of one indicator in a cycle: how many people got each value
 * 1-5, with n and mean, per area or manager of the snapshot (or of today with
 * `hierarchy: "current"`) or all together. People: everything; a manager: their
 * direct reports; direction: only groups of at least the minimum size (smaller
 * ones are folded into "others" or hidden); an employee: forbidden.
 */
export async function indicatorDistribution(
  db: DbOrTx,
  actor: IndicatorActor,
  input: Common & {
    cycleId: string;
    indicator: Indicator;
    groupBy: IndicatorGroupBy;
    hierarchy?: Hierarchy;
  },
): Promise<IndicatorDistribution> {
  const scope = requireIndicatorScope(actor);
  await requireCycle(db, input.cycleId);
  const config = await indicatorConfig(db, input.config);
  const col = groupColumns[input.groupBy];
  const rows = await db.execute<{
    key: string | null;
    label: string | null;
    value: number;
    n: number;
  }>(sql`
    with ${indicatorCtes(actor, scope, {
      cycleId: input.cycleId,
      hierarchy: input.hierarchy ?? "asOf",
    })}
    select ${col.key} as key, ${col.label} as label, i.value, count(*)::int as n
    from ind i
    where i.indicator = ${input.indicator} ${andAll(filterConds(input.filters))}
    group by 1, 2, 3`);
  const groups = new Map<
    string,
    { key: string | null; label: string | null; counts: number[] }
  >();
  const all = emptyCounts();
  for (const r of rows) {
    const id = r.key ?? "";
    const g = groups.get(id) ?? {
      key: r.key,
      label: r.label,
      counts: emptyCounts(),
    };
    g.counts[r.value - 1] += r.n;
    all[r.value - 1] += r.n;
    groups.set(id, g);
  }
  const total = seriesOf(all, null, null);
  let series =
    input.groupBy === "none"
      ? total.n
        ? [total]
        : []
      : [...groups.values()]
          .map((g) => seriesOf(g.counts, g.key, g.label))
          .sort(byLabel);
  const base = {
    cycleId: input.cycleId,
    indicator: input.indicator,
    groupBy: input.groupBy,
  };
  if (scope !== "aggregatesOnly") {
    return { ...base, series, total, suppressed: 0, minGroupSize: null };
  }
  const min = config.minGroupSize;
  const kept = applyMinimum(series, min);
  series = kept.series;
  return {
    ...base,
    series,
    // The total would give a hidden group away by subtraction.
    total: kept.suppressed === 0 && total.n >= min ? total : null,
    suppressed: kept.suppressed,
    minGroupSize: min,
  };
}

// ------------------------------------------------------------------- trend

/**
 * One indicator cycle by cycle (in period order) for a person, a team (the
 * manager of the snapshot), an area, or everybody the actor reads when no
 * subject is given. A manager reads a person only in the cycles where they
 * were their direct report, and only their own team. Direction reads teams,
 * areas and the whole organisation, with cycles under the minimum suppressed,
 * never a person; an employee reads nothing.
 */
export async function indicatorTrend(
  db: DbOrTx,
  actor: IndicatorActor,
  input: {
    indicator: Indicator;
    personId?: string;
    managerId?: string;
    department?: string;
    config?: Partial<IndicatorConfig>;
  },
): Promise<IndicatorTrend> {
  const scope = requireIndicatorScope(actor);
  const given = [input.personId, input.managerId, input.department].filter(
    (v) => v !== undefined,
  );
  if (given.length > 1) throw new ReviewError("validation");
  const config = await indicatorConfig(db, input.config);
  const conds: SQL[] = [];
  let subject: TrendSubject = { kind: "all" };
  if (input.personId !== undefined) {
    const personId = requireUuid(input.personId);
    if (scope === "aggregatesOnly") throw new ReviewError("forbidden");
    if (scope === "directReports") {
      const [report] = await db.execute(
        sql`select 1 from cycle_participant
            where reviewee_person_id = ${personId}::uuid
              and snap_manager_person_id = ${actor.personId}::uuid
              and removed_at is null`,
      );
      if (!report) throw new ReviewError("forbidden");
    }
    const [row] = await db.execute<{ name: string }>(
      sql`select display_name as name from person where id = ${personId}::uuid`,
    );
    if (!row) throw new ReviewError("not_found");
    subject = { kind: "person", personId, name: row.name };
    conds.push(sql`i.person_id = ${personId}::uuid`);
  } else if (input.managerId !== undefined) {
    const managerId = requireUuid(input.managerId);
    if (scope === "directReports" && managerId !== actor.personId) {
      throw new ReviewError("forbidden");
    }
    const [row] = await db.execute<{ name: string }>(
      sql`select display_name as name from person where id = ${managerId}::uuid`,
    );
    if (!row) throw new ReviewError("not_found");
    subject = { kind: "manager", managerId, name: row.name };
    conds.push(sql`i.manager_id = ${managerId}::uuid`);
  } else if (input.department !== undefined) {
    subject = { kind: "department", department: input.department };
    conds.push(sql`i.department = ${input.department}`);
  }
  const rows = await db.execute<{
    cycle_id: string;
    cycle_name: string;
    period_start: string;
    value: number;
    n: number;
  }>(sql`
    with ${indicatorCtes(actor, scope, { hierarchy: "asOf" })}
    select i.cycle_id, i.cycle_name, i.period_start, i.value, count(*)::int as n
    from ind i
    where i.indicator = ${input.indicator} ${andAll(conds)}
    group by 1, 2, 3, 4
    order by 3, 2`);
  const cycles = new Map<
    string,
    { name: string; start: string; counts: number[] }
  >();
  for (const r of rows) {
    const c = cycles.get(r.cycle_id) ?? {
      name: r.cycle_name,
      start: r.period_start,
      counts: emptyCounts(),
    };
    c.counts[r.value - 1] += r.n;
    cycles.set(r.cycle_id, c);
  }
  const min = scope === "aggregatesOnly" ? config.minGroupSize : null;
  const points: TrendPoint[] = [...cycles].map(([cycleId, c]) => {
    const s = seriesOf(c.counts, null, null);
    const hidden = min !== null && s.n < min;
    return {
      cycleId,
      cycleName: c.name,
      periodStart: c.start,
      n: hidden ? null : s.n,
      mean: hidden ? null : s.mean,
      counts: hidden ? null : s.counts,
      suppressed: hidden,
    };
  });
  return { indicator: input.indicator, subject, points, minGroupSize: min };
}

// ------------------------------------------------------------- risk matrix

/** Rows of the matrix: who has both indicators in the cycle. */
type PairRow = {
  person_id: string;
  name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  department: string | null;
  retention: number;
  engagement: number;
};

/**
 * Retention × engagement of a cycle in three bands per axis (low: up to the
 * risk threshold, mid, high), with the people of each cell counted; the cell
 * with both low is the risk quadrant. Only People gets the list of who is in
 * it (never a manager or direction, who get counts); direction sees cells of
 * at least the minimum, and the total only when no cell is hidden.
 */
export async function riskMatrix(
  db: DbOrTx,
  actor: IndicatorActor,
  input: Common & { cycleId: string },
): Promise<RiskMatrix> {
  const scope = requireIndicatorScope(actor);
  await requireCycle(db, input.cycleId);
  const config = await indicatorConfig(db, input.config);
  const withNames = scope === "all";
  const rows = await db.execute<PairRow>(sql`
    with ${indicatorCtes(actor, scope, {
      cycleId: input.cycleId,
      hierarchy: "asOf",
    })}
    select i.person_id,
           ${withNames ? sql`i.name` : sql`null::text`} as name,
           ${withNames ? sql`i.manager_id` : sql`null::uuid`} as manager_id,
           ${withNames ? sql`i.manager_name` : sql`null::text`} as manager_name,
           ${withNames ? sql`i.department` : sql`null::text`} as department,
           i.value as retention, e.value as engagement
    from ind i
    join ind e on e.participant_id = i.participant_id and e.indicator = 'engagement'
    where i.indicator = 'retention' ${andAll(filterConds(input.filters))}`);
  const counts = new Map<string, number>();
  const atRisk: RiskPerson[] = [];
  for (const r of rows) {
    const retention = bandOf(r.retention, config.riskThreshold);
    const engagement = bandOf(r.engagement, config.riskThreshold);
    const k = `${retention}:${engagement}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (withNames && retention === "low" && engagement === "low") {
      atRisk.push({
        personId: r.person_id,
        name: r.name!,
        managerId: r.manager_id,
        managerName: r.manager_name,
        department: r.department,
        retention: r.retention,
        engagement: r.engagement,
      });
    }
  }
  atRisk.sort(
    (a, b) =>
      a.retention + a.engagement - (b.retention + b.engagement) ||
      a.name.localeCompare(b.name, "es"),
  );
  const min = scope === "aggregatesOnly" ? config.minGroupSize : null;
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
  const risk = cells.find((c) => c.risk)!;
  return {
    cycleId: input.cycleId,
    riskThreshold: config.riskThreshold,
    cells,
    total: suppressed ? null : rows.length,
    riskCount: risk.count,
    atRisk: withNames ? atRisk : null,
    suppressed,
    minGroupSize: min,
  };
}

// ------------------------------------------------------------------ alerts

type AlertRow = {
  person_id: string;
  name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  department: string | null;
  indicator: Indicator;
  value: number;
  prev_value: number | null;
  prev_cycle_id: string | null;
  prev_cycle_name: string | null;
};

const kindOrder = { risk: 0, drop: 1 } as const;

/**
 * The alerts of a cycle: `drop`, an indicator that fell by the drop threshold
 * or more since the previous cycle the person has a value in, and `risk`,
 * retention and engagement both at or below the risk threshold. People and
 * the direct manager get them with the person; direction only the number of
 * people (when at least the minimum); an employee is forbidden. The previous
 * value of a manager's report is read only from cycles where the person was
 * also their direct report.
 */
export async function indicatorAlerts(
  db: DbOrTx,
  actor: IndicatorActor,
  input: Common & { cycleId: string },
): Promise<IndicatorAlerts> {
  const scope = requireIndicatorScope(actor);
  await requireCycle(db, input.cycleId);
  const config = await indicatorConfig(db, input.config);
  const named = scope !== "aggregatesOnly";
  const rows = await db.execute<AlertRow>(sql`
    with ${indicatorCtes(actor, scope, { hierarchy: "asOf" })}
    select i.person_id,
           ${named ? sql`i.name` : sql`null::text`} as name,
           ${named ? sql`i.manager_id` : sql`null::uuid`} as manager_id,
           ${named ? sql`i.manager_name` : sql`null::text`} as manager_name,
           ${named ? sql`i.department` : sql`null::text`} as department,
           i.indicator, i.value,
           p.value as prev_value, p.cycle_id as prev_cycle_id,
           p.cycle_name as prev_cycle_name
    from ind i
    left join lateral (
      select p.value, p.cycle_id, p.cycle_name
      from ind p
      where p.person_id = i.person_id and p.indicator = i.indicator
        and p.period_start < i.period_start
      order by p.period_start desc, p.cycle_id
      limit 1
    ) p on true
    where i.cycle_id = ${requireUuid(input.cycleId)}::uuid ${andAll(filterConds(input.filters))}`);
  const people = new Map<string, { person: AlertPerson; rows: AlertRow[] }>();
  for (const r of rows) {
    const p = people.get(r.person_id) ?? {
      person: {
        personId: r.person_id,
        name: r.name ?? "",
        managerId: r.manager_id,
        managerName: r.manager_name,
        department: r.department,
      },
      rows: [],
    };
    p.rows.push(r);
    people.set(r.person_id, p);
  }
  const alerts: IndicatorAlert[] = [];
  let withDrop = 0;
  let atRisk = 0;
  for (const { person, rows: own } of people.values()) {
    const value = (i: Indicator) => own.find((r) => r.indicator === i)?.value;
    const retention = value("retention");
    const engagement = value("engagement");
    let dropped = false;
    for (const r of own) {
      if (r.prev_value === null || r.prev_cycle_id === null) continue;
      const delta = r.prev_value - r.value;
      if (delta < config.dropThreshold) continue;
      dropped = true;
      alerts.push({
        kind: "drop",
        indicator: r.indicator,
        person,
        previousCycleId: r.prev_cycle_id,
        previousCycleName: r.prev_cycle_name!,
        previousValue: r.prev_value,
        value: r.value,
        delta,
      });
    }
    if (dropped) withDrop++;
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
  const min = scope === "aggregatesOnly" ? config.minGroupSize : null;
  const visible = (n: number) => (min !== null && n > 0 && n < min ? null : n);
  return {
    cycleId: input.cycleId,
    dropThreshold: config.dropThreshold,
    riskThreshold: config.riskThreshold,
    peopleWithDrop: visible(withDrop),
    peopleAtRisk: visible(atRisk),
    alerts: scope === "aggregatesOnly" ? [] : alerts,
    minGroupSize: min,
  };
}

// ----------------------------------------------------------- filter options

export type IndicatorFilterOptions = {
  departments: string[];
  managers: { id: string; name: string }[];
};

/** Values of the area / manager selects: those of the actor's participants in the cycle. */
export async function indicatorFilterOptions(
  db: DbOrTx,
  actor: IndicatorActor,
  input: { cycleId: string },
): Promise<IndicatorFilterOptions> {
  const scope = requireIndicatorScope(actor);
  await requireCycle(db, input.cycleId);
  const rows = await db.execute<{
    department: string | null;
    manager_id: string | null;
    manager_name: string | null;
  }>(sql`
    with ${indicatorCtes(actor, scope, {
      cycleId: input.cycleId,
      hierarchy: "asOf",
    })}
    select distinct department, manager_id, manager_name from base`);
  const departments = [
    ...new Set(rows.map((r) => r.department).filter((d): d is string => !!d)),
  ].sort((a, b) => a.localeCompare(b, "es"));
  const managers = new Map<string, string>();
  for (const r of rows) {
    if (r.manager_id && r.manager_name) {
      managers.set(r.manager_id, r.manager_name);
    }
  }
  return {
    departments,
    managers: [...managers]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
  };
}

// ------------------------------------------------------------------ pickers

export type IndicatorCycle = {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
};

/** Launched cycles, the latest period first (the order of the cycle picker). */
export async function indicatorCycles(db: DbOrTx): Promise<IndicatorCycle[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    period_start: string;
    period_end: string;
  }>(sql`
    select id, name, period_start::text as period_start, period_end::text as period_end
    from review_cycle
    where deleted_at is null and status <> 'draft'
    order by period_start desc, name`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    periodStart: r.period_start,
    periodEnd: r.period_end,
  }));
}

export type IndicatorSubjects = {
  departments: string[];
  managers: { id: string; name: string }[];
  /** People the actor may read one by one (never for direction). */
  people: { id: string; name: string }[];
};

/** Who the trend can be drawn for: the areas, managers and people in the actor's reach. */
export async function indicatorSubjects(
  db: DbOrTx,
  actor: IndicatorActor,
): Promise<IndicatorSubjects> {
  const scope = requireIndicatorScope(actor);
  const rows = await db.execute<{
    person_id: string;
    name: string;
    department: string | null;
    manager_id: string | null;
    manager_name: string | null;
  }>(sql`
    with ${indicatorCtes(actor, scope, { hierarchy: "asOf" })}
    select distinct person_id, name, department, manager_id, manager_name from base`);
  const departments = new Set<string>();
  const managers = new Map<string, string>();
  const people = new Map<string, string>();
  for (const r of rows) {
    if (r.department) departments.add(r.department);
    if (r.manager_id && r.manager_name)
      managers.set(r.manager_id, r.manager_name);
    if (scope !== "aggregatesOnly") people.set(r.person_id, r.name);
  }
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, "es");
  const listOf = (m: Map<string, string>) =>
    [...m].map(([id, name]) => ({ id, name })).sort(byName);
  return {
    departments: [...departments].sort((a, b) => a.localeCompare(b, "es")),
    managers: listOf(managers),
    people: listOf(people),
  };
}
