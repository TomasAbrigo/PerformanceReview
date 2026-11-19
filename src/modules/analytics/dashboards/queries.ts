import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { LocalizedText } from "@/db/schema/rating-scales";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { foldSmallGroups } from "@/modules/insights/aggregation";
import { insightsScope } from "@/modules/insights/authz";
import {
  type OrgFilters,
  type OrgOptions,
  orgOptionsOf,
} from "@/modules/org-attributes/kinds";
import { ReviewError } from "@/modules/review-core/review-errors";
import { getSetting } from "@/modules/settings/service";
import type { Relationship } from "@/modules/templates/constants";
import { ALL_PEOPLE, ratingCte, requirePeopleScope, scopedCtes } from "./scope";
import {
  BIN_COUNT,
  binOf,
  bins,
  type CycleProgress,
  type DashboardFilters,
  type ExecutiveSummary,
  type GoalsVsRatingRow,
  type GroupBy,
  type RatingDistribution,
  type RatingStage,
  type SelfManagerGap,
} from "./types";

const requireCycle = (cycleId: string | undefined): string => {
  if (!cycleId || !isUuid(cycleId)) throw new ReviewError("not_found");
  return cycleId;
};

/**
 * Cycle progress: review requests by relationship × department × manager
 * (per hierarchy), with the cycle's phase. aggregateOnly drops the manager.
 */
export async function cycleProgress(
  db: DbOrTx,
  actor: ActorContext,
  f: DashboardFilters,
): Promise<CycleProgress> {
  requirePeopleScope(actor);
  const cycleId = requireCycle(f.cycleId);
  const [cycle] = await db.execute<{ status: string }>(
    sql`select status from review_cycle where id = ${cycleId}::uuid`,
  );
  if (!cycle) throw new ReviewError("not_found");
  const agg = !!f.aggregateOnly;
  const rows = await db.execute<{
    relationship: Relationship;
    department: string | null;
    manager_id: string | null;
    manager_name: string | null;
    total: number;
    submitted: number;
    draft: number;
    declined: number;
  }>(sql`
    with recursive ${scopedCtes(actor, f)}
    select r.relationship, s.department,
           ${agg ? sql`null::uuid` : sql`s.manager_id`} as manager_id,
           ${agg ? sql`null::text` : sql`s.manager_name`} as manager_name,
           count(*)::int as total,
           count(*) filter (where r.status = 'submitted')::int as submitted,
           count(*) filter (where r.status = 'draft')::int as draft,
           count(*) filter (where r.status = 'declined')::int as declined
    from review_request r join scoped s on s.participant_id = r.participant_id
    where r.deleted_at is null and r.status <> 'superseded'
    group by 1, 2, 3, 4
    order by 1, 2 nulls last, 4 nulls last`);
  const totals = new Map<Relationship, CycleProgress["totals"][number]>();
  for (const r of rows) {
    const t = totals.get(r.relationship) ?? {
      relationship: r.relationship,
      total: 0,
      submitted: 0,
      draft: 0,
      declined: 0,
    };
    t.total += r.total;
    t.submitted += r.submitted;
    t.draft += r.draft;
    t.declined += r.declined;
    totals.set(r.relationship, t);
  }
  return {
    cycleId,
    status: cycle.status,
    rows: rows.map((r) => ({
      relationship: r.relationship,
      department: r.department,
      managerId: r.manager_id,
      managerName: r.manager_name,
      total: r.total,
      submitted: r.submitted,
      draft: r.draft,
      declined: r.declined,
    })),
    totals: [...totals.values()],
  };
}

const groupColumns: Record<GroupBy, { key: string; label: string }> = {
  department: { key: "s.department", label: "s.department" },
  manager: { key: "s.manager_id::text", label: "s.manager_name" },
  location: { key: "s.location", label: "s.location" },
  jobTitle: { key: "s.job_title", label: "s.job_title" },
};

/**
 * Distribution of normalized ratings (BIN_COUNT bins over 0-1, so cycles
 * with different scales compare) pre (manager) or post (current) calibration,
 * grouped by department, manager, location or job title. No cycleId: every
 * cycle. aggregateOnly: a single unnamed series (no manager grouping leaks).
 */
export async function ratingDistribution(
  db: DbOrTx,
  actor: ActorContext,
  f: DashboardFilters & { groupBy: GroupBy; stage: RatingStage },
): Promise<RatingDistribution> {
  requirePeopleScope(actor);
  const single = !!f.aggregateOnly && f.groupBy === "manager";
  const col = groupColumns[f.groupBy];
  const rows = await db.execute<{
    key: string | null;
    label: string | null;
    normalized: number;
  }>(sql`
    with recursive ${scopedCtes(actor, f)}, ${ratingCte(f.stage)}
    select ${single ? sql`null` : sql.raw(col.key)} as key,
           ${single ? sql`null` : sql.raw(col.label)} as label,
           rt.normalized
    from scoped s join rating rt on rt.participant_id = s.participant_id
    order by 2 nulls last, 1 nulls last`);
  const series = new Map<string, RatingDistribution["series"][number]>();
  const total = Array<number>(BIN_COUNT).fill(0);
  for (const r of rows) {
    const id = r.key ?? "";
    const s = series.get(id) ?? {
      key: r.key,
      label: r.label,
      counts: Array<number>(BIN_COUNT).fill(0),
      n: 0,
      mean: 0,
    };
    const b = binOf(r.normalized);
    s.counts[b]++;
    total[b]++;
    s.mean = (s.mean! * s.n + r.normalized) / (s.n + 1);
    s.n++;
    series.set(id, s);
  }
  return { bins, series: [...series.values()], total };
}

/** Goals of the period (the cycle's goal snapshot) vs the current rating. */
export async function goalsVsRating(
  db: DbOrTx,
  actor: ActorContext,
  f: DashboardFilters,
): Promise<{ rows: GoalsVsRatingRow[] }> {
  requirePeopleScope(actor);
  requireCycle(f.cycleId);
  const rows = await db.execute<{
    participant_id: string;
    person_id: string;
    name: string;
    goals: number;
    completed: number;
    avg_progress: number | null;
    normalized: number | null;
  }>(sql`
    with recursive ${scopedCtes(actor, f)}, ${ratingCte("current")}
    select s.participant_id, s.person_id, s.name,
           count(g.id)::int as goals,
           count(g.id) filter (where g.status = 'completed')::int as completed,
           round(avg(g.percent_complete))::int as avg_progress,
           rt.normalized
    from scoped s
    left join participant_goal_snapshot g on g.participant_id = s.participant_id
      and not g.no_longer_applicable
    left join rating rt on rt.participant_id = s.participant_id
    group by s.participant_id, s.person_id, s.name, rt.normalized
    order by s.name`);
  return {
    rows: rows.map((r) => ({
      participantId: r.participant_id,
      personId: r.person_id,
      name: r.name,
      goals: r.goals,
      completed: r.completed,
      avgProgress: r.avg_progress,
      normalized: r.normalized,
    })),
  };
}

/**
 * Gap manager − self (normalized) on the rating questions both answered,
 * only between submitted reviews; per question and per person. Computed
 * from answers directly (independent of the compare view of #48).
 */
export async function selfManagerGap(
  db: DbOrTx,
  actor: ActorContext,
  f: DashboardFilters,
  /** `byPerson: false` skips the per-person query (byPerson comes back empty). */
  options: { byPerson?: boolean } = {},
): Promise<SelfManagerGap> {
  requirePeopleScope(actor);
  requireCycle(f.cycleId);
  const pairs = sql`
    pairs as (
      select s.participant_id, s.person_id, s.name, sa.question_revision_id,
             sa.normalized::float8 as self, ma.normalized::float8 as manager
      from scoped s
      join review_request sr on sr.participant_id = s.participant_id
        and sr.relationship = 'self' and sr.status = 'submitted' and sr.deleted_at is null
      join answer sa on sa.request_id = sr.id and sa.normalized is not null
      join review_request mr on mr.participant_id = s.participant_id
        and mr.relationship = 'manager' and mr.status = 'submitted' and mr.deleted_at is null
      join answer ma on ma.request_id = mr.id
        and ma.question_revision_id = sa.question_revision_id
        and ma.normalized is not null
    )`;
  const ctes = sql`with recursive ${scopedCtes(actor, f)}, ${pairs}`;
  const byQuestion = await db.execute<{
    id: string;
    prompt: LocalizedText;
    n: number;
    self: number;
    manager: number;
    gap: number;
  }>(sql`${ctes}
    select q.id, q.prompt, count(*)::int as n, avg(p.self) as self,
           avg(p.manager) as manager, avg(p.manager - p.self) as gap
    from pairs p join question_revision q on q.id = p.question_revision_id
    group by q.id, q.prompt, q.sort order by q.sort`);
  type PersonGapRow = {
    participant_id: string;
    person_id: string;
    name: string;
    n: number;
    gap: number;
  };
  const byPerson: PersonGapRow[] =
    options.byPerson === false
      ? []
      : await db.execute<PersonGapRow>(sql`${ctes}
    select participant_id, person_id, name, count(*)::int as n,
           avg(manager - self) as gap
    from pairs group by 1, 2, 3 order by gap, name`);
  return {
    byQuestion: byQuestion.map((r) => ({
      questionRevisionId: r.id,
      prompt: r.prompt,
      n: r.n,
      meanSelf: r.self,
      meanManager: r.manager,
      meanGap: r.gap,
    })),
    byPerson: byPerson.map((r) => ({
      participantId: r.participant_id,
      personId: r.person_id,
      name: r.name,
      n: r.n,
      meanGap: r.gap,
    })),
  };
}

/**
 * Executive (aggregate-only) view, no names or ids. People see every group
 * unmasked (only people without a department are put together, as "Otros");
 * direction only what reaches `minGroupSize` (the `aggregation.minGroupSize`
 * setting unless given): departments under it are folded into "Otros", which
 * is hidden too if it is still under it, and a cycle with fewer participants
 * than that shows only its head count. Managers and employees are forbidden.
 */
export async function executiveSummary(
  db: DbOrTx,
  actor: ActorContext,
  f: {
    cycleId: string;
    minGroupSize?: number;
    /** An account, project, DM or Santex Lead to narrow to: People only (direction reads the whole cycle). */
    filters?: OrgFilters;
  },
): Promise<ExecutiveSummary> {
  // The scope decides: People see all, direction aggregates over the minimum.
  const scope = insightsScope(
    actor,
    f.minGroupSize ?? (await getSetting(db, "aggregation.minGroupSize")),
  );
  if (scope.kind !== "all" && scope.kind !== "aggregatesOnly") {
    throw new ReviewError("forbidden");
  }
  const min = scope.kind === "aggregatesOnly" ? scope.minGroupSize : 1;
  // Computed over everybody (the actor was authorized above) and masked here.
  const filters: DashboardFilters = {
    ...(scope.kind === "all" ? f.filters : {}),
    cycleId: f.cycleId,
    hierarchy: "asOf",
    aggregateOnly: true,
  };
  const [progress, dist, [count]] = await Promise.all([
    cycleProgress(db, ALL_PEOPLE, filters),
    ratingDistribution(db, ALL_PEOPLE, {
      ...filters,
      groupBy: "department",
      stage: "current",
    }),
    db.execute<{ n: number }>(sql`
      with recursive ${scopedCtes(ALL_PEOPLE, filters)}
      select count(*)::int as n from scoped`),
  ]);
  const empty = Array<number>(BIN_COUNT).fill(0);
  const rated = dist.total.reduce((a, b) => a + b, 0);
  const masked = scope.kind === "aggregatesOnly";
  if (masked && count.n < min) {
    return {
      minGroupSize: min,
      participants: count.n,
      progress: [],
      distribution: empty,
      rated,
      byDepartment: [],
      others: null,
      suppressed: rated,
    };
  }
  const { shown, others, suppressed } = foldSmallGroups(
    dist.series.map((s) => ({
      key: s.key,
      n: s.n,
      mean: s.mean,
      counts: s.counts,
    })),
    min,
  );
  return {
    minGroupSize: masked ? min : null,
    participants: count.n,
    progress: progress.totals.map((t) => ({
      relationship: t.relationship,
      total: t.total,
      submitted: t.submitted,
    })),
    distribution: masked && rated < min ? empty : dist.total,
    rated,
    byDepartment: shown.flatMap((g) =>
      g.key === null
        ? []
        : [{ department: g.key, n: g.n, mean: g.mean, counts: g.counts }],
    ),
    others,
    suppressed,
  };
}

export type FilterOptions = {
  departments: string[];
  managers: { id: string; name: string }[];
  locations: string[];
  jobTitles: string[];
  /** Accounts, projects, DMs and Santex Leads of the participants in view. */
  org: OrgOptions;
};

/** Values for the filter selects: what the actor's participants carry. */
export async function dashboardFilterOptions(
  db: DbOrTx,
  actor: ActorContext,
  f: Pick<DashboardFilters, "cycleId" | "hierarchy">,
): Promise<FilterOptions> {
  requirePeopleScope(actor);
  const rows = await db.execute<{
    department: string | null;
    manager_id: string | null;
    manager_name: string | null;
    location: string | null;
    job_title: string | null;
    account: string | null;
    project: string | null;
    dm: string | null;
    santex_lead: string | null;
  }>(sql`
    with recursive ${scopedCtes(actor, f)}
    select distinct department, manager_id, manager_name, location, job_title,
           account, project, dm, santex_lead
    from scoped`);
  const uniq = (xs: (string | null)[]) =>
    [...new Set(xs.filter((x): x is string => !!x))].sort();
  const managers = new Map<string, string>();
  for (const r of rows) {
    if (r.manager_id && r.manager_name)
      managers.set(r.manager_id, r.manager_name);
  }
  return {
    departments: uniq(rows.map((r) => r.department)),
    managers: [...managers]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    locations: uniq(rows.map((r) => r.location)),
    jobTitles: uniq(rows.map((r) => r.job_title)),
    org: orgOptionsOf(
      rows.map((r) => ({
        account: r.account,
        project: r.project,
        dm: r.dm,
        santexLead: r.santex_lead,
      })),
    ),
  };
}
