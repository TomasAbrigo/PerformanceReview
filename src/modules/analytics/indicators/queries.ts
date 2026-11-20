import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import type { Hierarchy } from "@/modules/analytics/dashboards/types";
import { groupKeyer } from "@/modules/org-attributes/group-key";
import {
  needsKeyer,
  type OrgOptions,
  withoutPersonFilters,
} from "@/modules/org-attributes/kinds";
import { ReviewError } from "@/modules/review-core/review-errors";
import {
  buildAlerts,
  buildDistribution,
  buildMatrix,
  buildTrend,
  matches,
  optionsOf,
  type Reach,
} from "./compute";
import {
  type IndicatorContext,
  type IndicatorRow,
  indicatorContext,
  loadRows,
  personInReach,
  previousIndicatorCycle,
  requireCycle,
  requireUuid,
} from "./rows";
import {
  type Indicator,
  type IndicatorAlerts,
  type IndicatorConfig,
  type IndicatorDistribution,
  type IndicatorFilters,
  type IndicatorGroupBy,
  indicators,
  type IndicatorTrend,
  type RiskMatrix,
  type TrendSubject,
} from "./types";

/**
 * Options every query takes besides its own. `hierarchy` is the org the area
 * and manager are read from: the cycle snapshot's (default) or today's; who
 * a manager may read is always decided on the snapshot.
 */
type Common = {
  filters?: IndicatorFilters;
  hierarchy?: Hierarchy;
  /** Replaces some thresholds for this call (tests); the settings otherwise. */
  config?: Partial<IndicatorConfig>;
};

const reachOf = (ctx: IndicatorContext): Reach => ctx.scope.kind;
const minOf = (ctx: IndicatorContext) =>
  ctx.scope.kind === "aggregatesOnly" ? ctx.scope.minGroupSize : null;

/** The keyer direction groups a DM or Santex Lead by (their teams have no name); none for anybody else. */
async function keyerFor(
  db: DbOrTx,
  ctx: IndicatorContext,
  groupBy: IndicatorGroupBy,
) {
  return ctx.scope.kind === "aggregatesOnly" && needsKeyer(groupBy)
    ? groupKeyer(db)
    : undefined;
}

/** Validates the filters (ids are ids) and returns them. */
function checkFilters(
  filters: IndicatorFilters = {},
  ctx: IndicatorContext,
): IndicatorFilters {
  if (filters.managerId) requireUuid(filters.managerId);
  // Direction does not filter by the people who lead a team (DM, Santex Lead).
  return withoutPersonFilters(filters, ctx.scope.kind === "aggregatesOnly");
}

type Cycle = { cycleId: string; indicator: Indicator };

/**
 * Distribution of one indicator in a cycle: how many people got each value
 * 1-5, with n and mean, per area or manager (of the snapshot, or of today with
 * `hierarchy: "current"`) or all together. People: everything; a manager:
 * their direct reports; direction: only groups of at least the minimum size
 * (smaller ones are folded into "others" or hidden); an employee: forbidden.
 */
export async function indicatorDistribution(
  db: DbOrTx,
  actor: ActorContext,
  input: Common &
    Cycle & {
      groupBy: IndicatorGroupBy;
    },
): Promise<IndicatorDistribution> {
  const ctx = await indicatorContext(db, actor, input.config);
  const filters = checkFilters(input.filters, ctx);
  await requireCycle(db, input.cycleId);
  const rows = await loadRows(db, ctx, {
    cycleId: input.cycleId,
    hierarchy: input.hierarchy ?? "asOf",
  });
  return buildDistribution(
    rows.filter((r) => matches(r, filters)),
    input,
    minOf(ctx),
    await keyerFor(db, ctx, input.groupBy),
  );
}

// ------------------------------------------------------------------- trend

type TrendInput = {
  personId?: string;
  managerId?: string;
  department?: string;
  hierarchy?: Hierarchy;
  config?: Partial<IndicatorConfig>;
};

/**
 * Who a trend is about and which rows are theirs; the authorization of the
 * subject lives here. A person: People, or a manager for someone who was
 * their direct report in a launched cycle (never themself; the rows are only
 * the cycles where they were); never direction. A team (a manager): People,
 * direction, or the manager themself. An area, or nobody (the whole reach).
 */
async function subjectOf(
  db: DbOrTx,
  ctx: IndicatorContext,
  input: TrendInput,
): Promise<{ subject: TrendSubject; has: (row: IndicatorRow) => boolean }> {
  const given = [input.personId, input.managerId, input.department].filter(
    (v) => v !== undefined,
  );
  if (given.length > 1) throw new ReviewError("validation");
  if (input.personId !== undefined) {
    const personId = requireUuid(input.personId);
    if (ctx.scope.kind === "aggregatesOnly") throw new ReviewError("forbidden");
    if (
      ctx.scope.kind === "directReports" &&
      !(await personInReach(db, ctx, personId))
    ) {
      throw new ReviewError("forbidden");
    }
    const [row] = await db.execute<{ name: string }>(
      sql`select display_name as name from person where id = ${personId}::uuid`,
    );
    if (!row) throw new ReviewError("not_found");
    return {
      subject: { kind: "person", personId, name: row.name },
      has: (r) => r.personId === personId,
    };
  }
  if (input.managerId !== undefined) {
    const managerId = requireUuid(input.managerId);
    if (
      ctx.scope.kind === "directReports" &&
      managerId !== ctx.scope.managerPersonId
    ) {
      throw new ReviewError("forbidden");
    }
    const [row] = await db.execute<{ name: string }>(
      sql`select display_name as name from person where id = ${managerId}::uuid`,
    );
    if (!row) throw new ReviewError("not_found");
    return {
      subject: { kind: "manager", managerId, name: row.name },
      has: (r) => r.managerId === managerId,
    };
  }
  if (input.department !== undefined) {
    const department = input.department;
    return {
      subject: { kind: "department", department },
      has: (r) => r.department === department,
    };
  }
  return { subject: { kind: "all" }, has: () => true };
}

/**
 * One indicator cycle by cycle (in the order of cycles: period, end, creation)
 * for a person, a team, an area, or everybody the actor reads when no subject
 * is given. A manager reads their team and the people who report to them, only
 * in the cycles where they did; direction reads teams, areas and the whole
 * organisation with the cycles under the minimum suppressed, never a person;
 * an employee reads nothing.
 */
export async function indicatorTrend(
  db: DbOrTx,
  actor: ActorContext,
  input: TrendInput & { indicator: Indicator },
): Promise<IndicatorTrend> {
  const ctx = await indicatorContext(db, actor, input.config);
  const { subject, has } = await subjectOf(db, ctx, input);
  const rows = await loadRows(db, ctx, {
    hierarchy: input.hierarchy ?? "asOf",
  });
  return buildTrend(rows.filter(has), input.indicator, subject, minOf(ctx));
}

export type IndicatorSubjects = {
  departments: string[];
  managers: { id: string; name: string }[];
  /** People the actor may read one by one (never for direction). */
  people: { id: string; name: string }[];
};

/**
 * The trend page in one read: both indicators of a subject and who the
 * picker can offer (areas, managers and people in the actor's reach).
 */
export async function indicatorTrendOverview(
  db: DbOrTx,
  actor: ActorContext,
  input: TrendInput,
): Promise<{
  trends: IndicatorTrend[];
  subjects: IndicatorSubjects;
}> {
  const ctx = await indicatorContext(db, actor, input.config);
  const { subject, has } = await subjectOf(db, ctx, input);
  const rows = await loadRows(db, ctx, {
    hierarchy: input.hierarchy ?? "asOf",
  });
  const mine = rows.filter(has);
  return {
    trends: indicators.map((indicator) =>
      buildTrend(mine, indicator, subject, minOf(ctx)),
    ),
    subjects: optionsOf(rows),
  };
}

/** Who the trend can be drawn for: the areas, managers and people in the actor's reach. */
export async function indicatorSubjects(
  db: DbOrTx,
  actor: ActorContext,
  input: Pick<Common, "hierarchy"> = {},
): Promise<IndicatorSubjects> {
  const ctx = await indicatorContext(db, actor);
  return optionsOf(
    await loadRows(db, ctx, { hierarchy: input.hierarchy ?? "asOf" }),
  );
}

// ------------------------------------------------------------- risk matrix

/**
 * Retention × engagement of a cycle in three bands per axis (low: up to the
 * risk threshold, mid, high), with the people of each cell counted; the cell
 * with both low is the risk quadrant. Those who may name people get the list
 * of who is in it (People: everybody; a manager: their direct reports, the
 * same people their alerts name); direction gets counts of cells of at least
 * the minimum, and the total only when no cell is hidden.
 */
export async function riskMatrix(
  db: DbOrTx,
  actor: ActorContext,
  input: Common & { cycleId: string },
): Promise<RiskMatrix> {
  const ctx = await indicatorContext(db, actor, input.config);
  const filters = checkFilters(input.filters, ctx);
  await requireCycle(db, input.cycleId);
  const rows = await loadRows(db, ctx, {
    cycleId: input.cycleId,
    hierarchy: input.hierarchy ?? "asOf",
  });
  return buildMatrix(
    rows.filter((r) => matches(r, filters)),
    input.cycleId,
    ctx.config,
    reachOf(ctx),
  );
}

// ------------------------------------------------------------------ alerts

/**
 * The alerts of a cycle: `drop`, an indicator that fell by the drop threshold
 * or more since the cycle right before it that asks the indicators (order of
 * period, end of period, creation, id; never an older one, #133), and
 * `risk`, retention and engagement both at or below the risk threshold.
 * People and the direct manager get them with the person; direction only the
 * number of people (when at least the minimum); an employee is forbidden. The
 * previous value of a manager's report is read only from cycles where the
 * person was also their direct report.
 */
export async function indicatorAlerts(
  db: DbOrTx,
  actor: ActorContext,
  input: Common & { cycleId: string },
): Promise<IndicatorAlerts> {
  const ctx = await indicatorContext(db, actor, input.config);
  const filters = checkFilters(input.filters, ctx);
  await requireCycle(db, input.cycleId);
  const rows = await loadRows(db, ctx, {
    hierarchy: input.hierarchy ?? "asOf",
  });
  return buildAlerts(
    rows,
    input.cycleId,
    await previousIndicatorCycle(db, input.cycleId),
    filters,
    ctx.config,
    reachOf(ctx),
  );
}

// ----------------------------------------------------------------- overview

export type IndicatorFilterOptions = {
  departments: string[];
  managers: { id: string; name: string }[];
  /** Accounts, projects, DMs and Santex Leads (the last two not for direction). */
  org: OrgOptions;
};

/**
 * The indicators page in one read: the distribution, the matrix and the
 * alerts of a cycle plus the values of the area and manager selects (those
 * of the people with indicators in the cycle, unfiltered), from a single
 * query of the rows and one authorization.
 */
export async function indicatorOverview(
  db: DbOrTx,
  actor: ActorContext,
  input: Common & Cycle & { groupBy: IndicatorGroupBy },
): Promise<{
  options: IndicatorFilterOptions;
  distribution: IndicatorDistribution;
  matrix: RiskMatrix;
  alerts: IndicatorAlerts;
}> {
  const ctx = await indicatorContext(db, actor, input.config);
  const filters = checkFilters(input.filters, ctx);
  await requireCycle(db, input.cycleId);
  const rows = await loadRows(db, ctx, {
    hierarchy: input.hierarchy ?? "asOf",
  });
  const inCycle = rows.filter((r) => r.cycleId === input.cycleId);
  const filtered = inCycle.filter((r) => matches(r, filters));
  const { departments, managers, org } = optionsOf(
    inCycle,
    minOf(ctx) === null,
  );
  return {
    options: { departments, managers, org },
    distribution: buildDistribution(
      filtered,
      input,
      minOf(ctx),
      await keyerFor(db, ctx, input.groupBy),
    ),
    matrix: buildMatrix(filtered, input.cycleId, ctx.config, reachOf(ctx)),
    alerts: buildAlerts(
      rows,
      input.cycleId,
      await previousIndicatorCycle(db, input.cycleId),
      filters,
      ctx.config,
      reachOf(ctx),
    ),
  };
}

/**
 * Both indicators of a cycle, all together (groupBy none), and the risk
 * matrix, from a single read of the rows and one authorization: the
 * executive view's tiles.
 */
export async function indicatorSnapshot(
  db: DbOrTx,
  actor: ActorContext,
  input: Pick<Common, "config" | "filters"> & { cycleId: string },
): Promise<{
  retention: IndicatorDistribution;
  engagement: IndicatorDistribution;
  matrix: RiskMatrix;
}> {
  const ctx = await indicatorContext(db, actor, input.config);
  const filters = checkFilters(input.filters, ctx);
  await requireCycle(db, input.cycleId);
  const rows = await loadRows(db, ctx, {
    cycleId: input.cycleId,
    hierarchy: "asOf",
  });
  const inCycle = rows.filter(
    (r) => r.cycleId === input.cycleId && matches(r, filters),
  );
  const dist = (indicator: Indicator) =>
    buildDistribution(
      inCycle,
      { cycleId: input.cycleId, indicator, groupBy: "none" },
      minOf(ctx),
    );
  return {
    retention: dist("retention"),
    engagement: dist("engagement"),
    matrix: buildMatrix(inCycle, input.cycleId, ctx.config, reachOf(ctx)),
  };
}

/** Values of the area / manager selects: those of the people with indicators in the cycle. */
export async function indicatorFilterOptions(
  db: DbOrTx,
  actor: ActorContext,
  input: { cycleId: string; hierarchy?: Hierarchy },
): Promise<IndicatorFilterOptions> {
  const ctx = await indicatorContext(db, actor);
  await requireCycle(db, input.cycleId);
  const { departments, managers, org } = optionsOf(
    await loadRows(db, ctx, {
      cycleId: input.cycleId,
      hierarchy: input.hierarchy ?? "asOf",
    }),
    minOf(ctx) === null,
  );
  return { departments, managers, org };
}

// ------------------------------------------------------------------ cycles

export type IndicatorCycle = {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  localizedName?: { es: string; en: string } | null;
};

/** Launched cycles, the latest period first (the order of the cycle picker). */
export async function indicatorCycles(db: DbOrTx): Promise<IndicatorCycle[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    period_start: string;
    period_end: string;
    localized_name: { es: string; en: string } | null;
  }>(sql`
    select id, name, localized_name, period_start::text as period_start, period_end::text as period_end
    from review_cycle
    where deleted_at is null and status <> 'draft'
    order by period_start desc, period_end desc, created_at desc, id desc`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    localizedName: r.localized_name,
    periodStart: r.period_start,
    periodEnd: r.period_end,
  }));
}
