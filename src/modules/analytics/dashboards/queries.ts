import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { LocalizedText } from "@/db/schema/rating-scales";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { ReviewError } from "@/modules/review-core/review-errors";
import type { Relationship } from "@/modules/templates/constants";
import {
  chainContains,
  isHr,
  isManager,
  ratingCte,
  requireHrOrManager,
  scopedCtes,
  subtree,
} from "./scope";
import {
  BIN_COUNT,
  binOf,
  bins,
  type CycleProgress,
  type DashboardFilters,
  type ExecutiveSummary,
  type GoalsVsRatingRow,
  type GroupBy,
  type Hierarchy,
  type ManagerTeam,
  MIN_GROUP,
  type PersonTrajectory,
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
  requireHrOrManager(actor);
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
  requireHrOrManager(actor);
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

/**
 * One person's trajectory across cycles: normalized current rating, with
 * the manager, title and area frozen at each cycle's snapshot. HR: all;
 * managers: cycles where the person was in their team then or is now;
 * the person themself: every cycle, rating only once calibration is
 * published. Anyone else: forbidden.
 */
export async function personTrajectory(
  db: DbOrTx,
  actor: ActorContext,
  personId: string,
): Promise<PersonTrajectory> {
  if (!isUuid(personId)) throw new ReviewError("not_found");
  const [p] = await db.execute<{ name: string }>(
    sql`select display_name as name from person where id = ${personId}::uuid`,
  );
  if (!p) throw new ReviewError("not_found");
  const own = actor.personId === personId;
  let scope = sql`true`;
  if (!isHr(actor) && !own) {
    if (!isManager(actor)) throw new ReviewError("forbidden");
    scope = sql`(${chainContains(sql`cp.snap_manager_person_id`, sql`c.snapshot_date`, actor.personId!)}
      or ${chainContains(
        sql`(select h.manager_person_id from employee_job_history h
             where h.person_id = cp.reviewee_person_id and h.deleted_at is null
               and h.valid_to is null order by h.valid_from desc limit 1)`,
        sql`current_date`,
        actor.personId!,
      )})`;
  }
  const hide = !isHr(actor) && own;
  const rows = await db.execute<{
    cycle_id: string;
    cycle_name: string;
    period_end: string;
    normalized: number | null;
    option_label: string | null;
    stage: string | null;
    manager_name: string | null;
    job_title: string | null;
    department: string | null;
    published: boolean;
  }>(sql`
    select c.id as cycle_id, c.name as cycle_name, c.period_end::text as period_end,
           v.normalized::float8 as normalized, v.option_label, v.stage::text as stage,
           m.display_name as manager_name, cp.snap_job_title as job_title,
           cp.snap_department as department,
           c.calibration_published_at is not null as published
    from cycle_participant cp
    join review_cycle c on c.id = cp.cycle_id
    left join person m on m.id = cp.snap_manager_person_id
    left join v_current_rating v on v.participant_id = cp.id
    where cp.reviewee_person_id = ${personId}::uuid and cp.removed_at is null
      and c.status <> 'draft' and ${scope}
    order by c.period_end, c.name`);
  if (!rows.length && !isHr(actor) && !own) throw new ReviewError("forbidden");
  return {
    personId,
    personName: p.name,
    points: rows.map((r) => {
      const visible = !hide || r.published;
      return {
        cycleId: r.cycle_id,
        cycleName: r.cycle_name,
        periodEnd: r.period_end,
        normalized: visible ? r.normalized : null,
        optionLabel: visible ? r.option_label : null,
        stage: visible ? r.stage : null,
        managerName: r.manager_name,
        jobTitle: r.job_title,
        department: r.department,
      };
    }),
  };
}

/**
 * A manager's whole subtree (recursive CTE over job history) on the cycle
 * snapshot date (asOf) or today (current), with each member's current
 * rating in the cycle. Managers may open their own team or a sub-team.
 */
export async function managerTeam(
  db: DbOrTx,
  actor: ActorContext,
  f: { managerId?: string; cycleId?: string; hierarchy: Hierarchy },
): Promise<ManagerTeam> {
  requireHrOrManager(actor);
  const managerId = f.managerId ?? actor.personId;
  if (!managerId || !isUuid(managerId)) throw new ReviewError("not_found");
  let date = sql`current_date`;
  let cycleId: string | null = null;
  if (f.cycleId) {
    cycleId = requireCycle(f.cycleId);
    if (f.hierarchy === "asOf") {
      date = sql`(select snapshot_date from review_cycle where id = ${cycleId}::uuid)`;
    }
  } else if (f.hierarchy === "asOf") {
    throw new ReviewError("not_found");
  }
  if (!isHr(actor) && managerId !== actor.personId) {
    const [ok] = await db.execute<{ ok: boolean }>(
      sql`with recursive sub as (${subtree(actor.personId!, date)})
          select exists (select 1 from sub where person_id = ${managerId}::uuid) as ok`,
    );
    if (!ok?.ok) throw new ReviewError("forbidden");
  }
  const rows = await db.execute<{
    person_id: string;
    name: string;
    depth: number;
    job_title: string | null;
    department: string | null;
    participant_id: string | null;
    normalized: number | null;
  }>(sql`
    with recursive sub as (${subtree(managerId, date)}),
    members as (select person_id, min(depth) as depth from sub group by person_id)
    select m.person_id, p.display_name as name, m.depth::int as depth,
           h.job_title, h.department, cp.id as participant_id,
           v.normalized::float8 as normalized
    from members m
    join person p on p.id = m.person_id
    left join lateral (
      select h.job_title, h.department from employee_job_history h
      where h.person_id = m.person_id and h.deleted_at is null
        and h.valid_from <= ${date} and (h.valid_to is null or h.valid_to > ${date})
      order by h.valid_from desc limit 1
    ) h on true
    left join cycle_participant cp on cp.reviewee_person_id = m.person_id
      and cp.removed_at is null
      and ${cycleId ? sql`cp.cycle_id = ${cycleId}::uuid` : sql`false`}
    left join v_current_rating v on v.participant_id = cp.id
    order by m.depth, p.display_name`);
  return {
    managerId,
    hierarchy: f.hierarchy,
    members: rows.map((r) => ({
      personId: r.person_id,
      name: r.name,
      depth: r.depth,
      jobTitle: r.job_title,
      department: r.department,
      participantId: r.participant_id,
      normalized: r.normalized,
    })),
  };
}

/** Goals of the period (the cycle's goal snapshot) vs the current rating. */
export async function goalsVsRating(
  db: DbOrTx,
  actor: ActorContext,
  f: DashboardFilters,
): Promise<{ rows: GoalsVsRatingRow[] }> {
  requireHrOrManager(actor);
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
): Promise<SelfManagerGap> {
  requireHrOrManager(actor);
  requireCycle(f.cycleId);
  const pairs = sql`
    pairs as (
      select s.participant_id, s.person_id, s.name, sa.question_revision_id,
             sa.normalized::float8 as self, ma.normalized::float8 as manager
      from scoped s
      join review_request sr on sr.participant_id = s.participant_id
        and sr.relationship = 'self' and sr.status = 'submitted'
      join answer sa on sa.request_id = sr.id and sa.normalized is not null
      join review_request mr on mr.participant_id = s.participant_id
        and mr.relationship = 'manager' and mr.status = 'submitted'
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
  const byPerson = await db.execute<{
    participant_id: string;
    person_id: string;
    name: string;
    n: number;
    gap: number;
  }>(sql`${ctes}
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
 * Executive (aggregate-only) view for leadership: HR only, no names or ids.
 * Departments with fewer than MIN_GROUP rated people are not broken out.
 */
export async function executiveSummary(
  db: DbOrTx,
  actor: ActorContext,
  f: { cycleId: string },
): Promise<ExecutiveSummary> {
  if (!isHr(actor)) throw new ReviewError("forbidden");
  const filters: DashboardFilters = {
    cycleId: f.cycleId,
    hierarchy: "asOf",
    aggregateOnly: true,
  };
  const progress = await cycleProgress(db, actor, filters);
  const dist = await ratingDistribution(db, actor, {
    ...filters,
    groupBy: "department",
    stage: "current",
  });
  const [count] = await db.execute<{ n: number }>(sql`
    with recursive ${scopedCtes(actor, filters)}
    select count(*)::int as n from scoped`);
  const byDepartment: ExecutiveSummary["byDepartment"] = [];
  let suppressed = 0;
  for (const s of dist.series) {
    if (s.key !== null && s.n >= MIN_GROUP) {
      byDepartment.push({
        department: s.key,
        n: s.n,
        mean: s.mean,
        counts: s.counts,
      });
    } else suppressed += s.n;
  }
  return {
    participants: count.n,
    progress: progress.totals.map((t) => ({
      relationship: t.relationship,
      total: t.total,
      submitted: t.submitted,
    })),
    distribution: dist.total,
    byDepartment,
    suppressed,
  };
}

export type FilterOptions = {
  departments: string[];
  managers: { id: string; name: string }[];
  locations: string[];
  jobTitles: string[];
};

/** Values for the filter selects: what the actor's participants carry. */
export async function dashboardFilterOptions(
  db: DbOrTx,
  actor: ActorContext,
  f: Pick<DashboardFilters, "cycleId" | "hierarchy">,
): Promise<FilterOptions> {
  requireHrOrManager(actor);
  const rows = await db.execute<{
    department: string | null;
    manager_id: string | null;
    manager_name: string | null;
    location: string | null;
    job_title: string | null;
  }>(sql`
    with recursive ${scopedCtes(actor, f)}
    select distinct department, manager_id, manager_name, location, job_title
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
  };
}
