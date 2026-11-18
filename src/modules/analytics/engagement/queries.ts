import { type SQL, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { insightsScope, type InsightsScope } from "@/modules/insights/authz";
import {
  engagementSegments,
  parseEngagementMonth,
  shiftMonth,
} from "@/modules/engagement/kinds";
import {
  orgOptionsOf,
  withoutPersonFilters,
} from "@/modules/org-attributes/kinds";
import {
  orgAttributeColumns,
  orgAttributeFilters,
  orgAttributeJoins,
} from "@/modules/org-attributes/sql";
import { ReviewError } from "@/modules/review-core/review-errors";
import { getSetting } from "@/modules/settings/service";
import { buildMonths, emptySegments } from "./derive";
import type {
  EngagementEvolution,
  EngagementFilterOptions,
  EngagementFilters,
  EngagementTile,
  MonthCounts,
} from "./types";

/** Months an evolution shows when the range is not given. */
export const DEFAULT_MONTHS = 12;

type Authorized = {
  scope: Exclude<InsightsScope, { kind: "none" }>;
  /** Direction's minimum group size, null for whoever reads everything in reach. */
  min: number | null;
};

/**
 * Who may read the monthly engagement: People everything, a manager their
 * direct reports (of each month), direction only aggregates. Employees (and a
 * manager acting without a person) are forbidden.
 */
async function authorize(
  db: DbOrTx,
  actor: ActorContext,
  override?: number,
): Promise<Authorized> {
  const first = insightsScope(actor);
  if (first.kind === "none") throw new ReviewError("forbidden");
  if (first.kind !== "aggregatesOnly") return { scope: first, min: null };
  const min = override ?? (await getSetting(db, "aggregation.minGroupSize"));
  return { scope: { kind: "aggregatesOnly", minGroupSize: min }, min };
}

/** `not_found` for a manager id that is not an id (before anything is read). */
function checkFilters(f: EngagementFilters) {
  if (f.managerId && !isUuid(f.managerId)) throw new ReviewError("not_found");
}

/** A first-of-month filter value, or `not_found` for anything else. */
function month(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = parseEngagementMonth(value);
  if (!parsed) throw new ReviewError("not_found");
  return parsed;
}

/**
 * CTE `rows` (person_id, month, score, segment, org columns): the engagement
 * rows of the range the actor may read, with the area, location, title and
 * manager of each person on the last day of each month, and the org
 * attributes as of that day, filtered. Direction is read over everybody and
 * masked afterwards, and without the filters that name a person.
 */
function rowsCte(
  a: Authorized,
  f: EngagementFilters,
  range: { from?: string; to?: string },
): SQL {
  const where: SQL[] = [sql`e.deleted_at is null`];
  if (range.from) where.push(sql`e.month >= ${range.from}::date`);
  if (range.to) where.push(sql`e.month <= ${range.to}::date`);
  const masked = a.scope.kind === "aggregatesOnly";
  const filters = withoutPersonFilters(f, masked);
  if (filters.department)
    where.push(sql`jh.department = ${filters.department}`);
  if (filters.location) where.push(sql`jh.location = ${filters.location}`);
  if (filters.jobTitle) where.push(sql`jh.job_title = ${filters.jobTitle}`);
  if (filters.managerId) {
    where.push(sql`jh.manager_person_id = ${filters.managerId}::uuid`);
  }
  where.push(...orgAttributeFilters(filters));
  if (a.scope.kind === "directReports") {
    where.push(
      sql`jh.manager_person_id = ${a.scope.managerPersonId}::uuid`,
      sql`e.person_id <> ${a.scope.managerPersonId}::uuid`,
    );
  }
  return sql`
    rows as (
      select e.person_id, e.month, e.score::float8 as score, e.segment::text as segment,
             jh.department, jh.location, jh.job_title, jh.manager_person_id,
             ${orgAttributeColumns}
      from (
        select e.*, (e.month + interval '1 month' - interval '1 day')::date as asof
        from engagement_monthly e
      ) e
      left join lateral (
        select h.department, h.location, h.job_title, h.manager_person_id
        from employee_job_history h
        where h.person_id = e.person_id and h.deleted_at is null
          and h.valid_from <= e.asof and (h.valid_to is null or h.valid_to > e.asof)
        order by h.valid_from desc
        limit 1
      ) jh on true
      ${orgAttributeJoins("e", sql`e.asof`, "person_id")}
      where ${sql.join(where, sql` and `)}
    )`;
}

/** The first and last month with data (null: none). */
async function monthBounds(
  db: DbOrTx,
): Promise<{ first: string | null; last: string | null }> {
  const [row] = await db.execute<{ first: string | null; last: string | null }>(
    sql`select min(month)::text as first, max(month)::text as last
        from engagement_monthly where deleted_at is null`,
  );
  return { first: row?.first ?? null, last: row?.last ?? null };
}

/** The range a view reads: what was asked, else the last `DEFAULT_MONTHS` with data. */
async function rangeOf(
  db: DbOrTx,
  f: Pick<EngagementFilters, "from" | "to">,
): Promise<{ from: string | null; to: string | null }> {
  const to = month(f.to);
  const from = month(f.from);
  if (to && from) return { from, to };
  const { last } = await monthBounds(db);
  const end = to ?? last;
  if (!end) return { from: null, to: null };
  return { from: from ?? shiftMonth(end, -(DEFAULT_MONTHS - 1)), to: end };
}

type CountsRow = {
  month: string;
  people: number;
  respondents: number;
  scored: number;
  mean: number | null;
  alto: number;
  medio: number;
  regular: number;
  bajo: number;
  falta: number;
};

async function loadMonths(
  db: DbOrTx,
  a: Authorized,
  f: EngagementFilters,
  range: { from: string; to: string },
): Promise<MonthCounts[]> {
  const rows = await db.execute<CountsRow>(sql`
    with ${rowsCte(a, f, range)}
    select month::text as month,
           count(*)::int as people,
           (count(*) filter (where segment <> 'falta'))::int as respondents,
           count(score)::int as scored,
           avg(score)::float8 as mean,
           (count(*) filter (where segment = 'alto'))::int as alto,
           (count(*) filter (where segment = 'medio'))::int as medio,
           (count(*) filter (where segment = 'regular'))::int as regular,
           (count(*) filter (where segment = 'bajo'))::int as bajo,
           (count(*) filter (where segment = 'falta'))::int as falta
    from rows
    group by month
    order by month`);
  return rows.map((r) => ({
    month: r.month,
    people: r.people,
    respondents: r.respondents,
    scored: r.scored,
    mean: r.mean,
    segments: {
      ...emptySegments(),
      ...Object.fromEntries(engagementSegments.map((s) => [s, r[s]])),
    },
  }));
}

/**
 * The monthly engagement month by month: people with a row, the share who
 * answered (participation), the mean score of those with one and how many
 * fall in each segment. People read everything, a manager their direct
 * reports, direction aggregates with the months and cells under
 * `aggregation.minGroupSize` hidden (see `EngagementMonth`) and without the
 * DM and Santex Lead filters. Employees are forbidden.
 */
export async function engagementEvolution(
  db: DbOrTx,
  actor: ActorContext,
  f: EngagementFilters = {},
): Promise<EngagementEvolution> {
  const a = await authorize(db, actor, f.minGroupSize);
  checkFilters(f);
  const { from, to } = await rangeOf(db, f);
  if (!from || !to) {
    return {
      months: [],
      from: null,
      to: null,
      minGroupSize: a.min,
      hiddenMonths: 0,
    };
  }
  const counts = await loadMonths(db, a, f, { from, to });
  return { ...buildMonths(counts, a.min), from, to, minGroupSize: a.min };
}

/**
 * The latest month with data next to the one before it (for the executive
 * view); null when there is no engagement data at all. Read as
 * `engagementEvolution` (direction: masked).
 */
export async function engagementTile(
  db: DbOrTx,
  actor: ActorContext,
  f: Omit<EngagementFilters, "from" | "to"> = {},
): Promise<EngagementTile | null> {
  const a = await authorize(db, actor, f.minGroupSize);
  checkFilters(f);
  const { last } = await monthBounds(db);
  if (!last) return null;
  const from = shiftMonth(last, -1);
  const counts = await loadMonths(db, a, f, { from, to: last });
  const { months } = buildMonths(counts, a.min);
  const latest = months.find((m) => m.month === last);
  if (!latest) return null;
  return {
    latest,
    previous: months.find((m) => m.month === from) ?? null,
    minGroupSize: a.min,
  };
}

/**
 * The values of the filter selects: those of the people with engagement in
 * reach (a manager: their reports; direction: areas, accounts and projects,
 * never DMs or Santex Leads), and the months that have data.
 */
export async function engagementFilterOptions(
  db: DbOrTx,
  actor: ActorContext,
): Promise<EngagementFilterOptions> {
  const a = await authorize(db, actor);
  const { first, last } = await monthBounds(db);
  const range = first && last ? { from: first, to: last } : {};
  const rows = await db.execute<{
    department: string | null;
    account: string | null;
    project: string | null;
    dm: string | null;
    santex_lead: string | null;
  }>(sql`
    with ${rowsCte(a, {}, range)}
    select distinct department, account, project, dm, santex_lead from rows`);
  const collator = new Intl.Collator("es");
  return {
    org: orgOptionsOf(
      rows.map((r) => ({
        account: r.account,
        project: r.project,
        dm: r.dm,
        santexLead: r.santex_lead,
      })),
      a.scope.kind !== "aggregatesOnly",
    ),
    departments: [
      ...new Set(rows.flatMap((r) => (r.department ? [r.department] : []))),
    ].sort((x, y) => collator.compare(x, y)),
    firstMonth: first,
    lastMonth: last,
  };
}
