import { and, desc, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { reviewCycle } from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import { canSeeEmail, type ActorContext } from "@/modules/actor/types";
import {
  ALL_PEOPLE,
  requirePeopleScope,
  scopedCtes,
} from "@/modules/analytics/dashboards/scope";
import type { DashboardFilters } from "@/modules/analytics/dashboards/types";
import {
  type GroupCell,
  foldSmallGroups,
} from "@/modules/insights/aggregation";
import { insightsScope } from "@/modules/insights/authz";
import { ReviewError } from "@/modules/review-core/review-errors";
import { getSetting } from "@/modules/settings/service";
import {
  type CompletionCounts,
  type CompletionCycle,
  type CompletionDelta,
  type CompletionDeltaRow,
  type CompletionGroup,
  type CompletionGroupBy,
  type CompletionSource,
  type CompletionSummary,
  deltaPoints,
  type Hierarchy,
  type MissingPerson,
  type MissingStatus,
  type SideStatus,
  withRates,
} from "./types";

export type CompletionFilters = {
  cycleId: string;
  /** Default: department. */
  groupBy?: CompletionGroupBy;
  /** Default: the org as of the cycle snapshot. */
  hierarchy?: Hierarchy;
  department?: string;
  managerId?: string;
  /** Direction's minimum group size; default: the `aggregation.minGroupSize` setting. */
  minGroupSize?: number;
};

/** The launched, not deleted, cycle `cycleId`; not found otherwise. */
async function requireCycle(
  db: DbOrTx,
  cycleId: string,
): Promise<{ id: string; name: string }> {
  if (!isUuid(cycleId)) throw new ReviewError("not_found");
  const [cycle] = await db.execute<{ id: string; name: string }>(sql`
    select id, name from review_cycle
    where id = ${cycleId}::uuid and deleted_at is null and status <> 'draft'`);
  if (!cycle) throw new ReviewError("not_found");
  return cycle;
}

/**
 * Where one side of a participant's assessment stands according to their
 * review requests: submitted if one is; otherwise in progress if a live
 * request already has answers, not started if it has none (or was declined),
 * and not applicable when there is no live request of that relationship.
 * Superseded and deleted requests do not count.
 */
const requestStatus = (relationship: "self" | "manager") => sql`
  select case
           when bool_or(r.status = 'submitted') then 'submitted'
           when count(*) = 0 then 'not_applicable'
           when bool_or(exists (select 1 from answer a where a.request_id = r.id))
             then 'in_progress'
           else 'not_started'
         end as status
  from review_request r
  where r.participant_id = s.participant_id
    and r.relationship = ${relationship}
    and r.deleted_at is null and r.status <> 'superseded'`;

/**
 * CTE `sides` (over `scoped`): the standing of each participant's self and
 * manager assessment. The source is chosen per participant: their
 * `assessment_progress` row (Bamboo's Assessment Progress report) when there
 * is one, else what their review requests say. Columns: participant_id,
 * person_id, name, department, manager_id, manager_name, source,
 * self_status, manager_status, has_notes.
 */
const sidesCte = sql`
  sides as (
    select s.participant_id, s.person_id, s.name, s.department,
           s.manager_id, s.manager_name,
           case when ap.id is null then 'requests' else 'progress' end as source,
           coalesce(ap.self_status::text, rs.status) as self_status,
           coalesce(ap.manager_status::text, rm.status) as manager_status,
           coalesce(btrim(ap.follow_up_notes), '') <> '' as has_notes
    from scoped s
    left join assessment_progress ap on ap.participant_id = s.participant_id
    left join lateral (${requestStatus("self")}) rs on ap.id is null
    left join lateral (${requestStatus("manager")}) rm on ap.id is null
  )`;

/** Direction's minimum group size: the override, else the setting. */
const minGroupSizeFor = async (db: DbOrTx, override?: number) =>
  override ?? (await getSetting(db, "aggregation.minGroupSize"));

const NONE: CompletionCounts = {
  participants: 0,
  selfSubmitted: 0,
  selfApplicable: 0,
  managerSubmitted: 0,
  managerApplicable: 0,
};

const add = (a: CompletionCounts, b: CompletionCounts): CompletionCounts => ({
  participants: a.participants + b.participants,
  selfSubmitted: a.selfSubmitted + b.selfSubmitted,
  selfApplicable: a.selfApplicable + b.selfApplicable,
  managerSubmitted: a.managerSubmitted + b.managerSubmitted,
  managerApplicable: a.managerApplicable + b.managerApplicable,
});

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

type GroupRow = {
  key: string | null;
  label: string | null;
  participants: number;
  self_submitted: number;
  self_applicable: number;
  manager_submitted: number;
  manager_applicable: number;
  from_progress: number;
};

/**
 * Completion of a cycle: how many participants submitted their self and their
 * manager assessment, all together or by department or manager (of the
 * snapshot, or today's: `hierarchy`). Percentages are over the participants
 * the side applies to (`not_applicable` sides are out). Statuses come from
 * each participant's `assessment_progress` row when they have one, else from
 * their review requests (see `sidesCte`).
 *
 * People read everything and a manager their direct reports; direction only
 * aggregates: no managers, no filters, groups under the minimum group size
 * folded into "Otros" (or hidden if that is under it too), and a cycle with
 * fewer participants than that shows only its head count. Employees (and a
 * manager acting without a person) are forbidden.
 */
export async function completionSummary(
  db: DbOrTx,
  actor: ActorContext,
  f: CompletionFilters,
): Promise<CompletionSummary> {
  const scope = insightsScope(
    actor,
    actor.role === "direction"
      ? await minGroupSizeFor(db, f.minGroupSize)
      : undefined,
  );
  if (scope.kind === "none") throw new ReviewError("forbidden");
  const cycle = await requireCycle(db, f.cycleId);
  const masked = scope.kind === "aggregatesOnly";
  const hierarchy = f.hierarchy ?? "asOf";
  // Direction reads aggregates by department only: a manager is a person.
  const requested = f.groupBy ?? "department";
  const groupBy: CompletionGroupBy =
    masked && requested === "manager" ? "none" : requested;
  const filters: DashboardFilters = {
    cycleId: cycle.id,
    hierarchy,
    ...(masked ? {} : { department: f.department, managerId: f.managerId }),
  };
  const column = {
    none: { key: sql`null::text`, label: sql`null::text` },
    department: { key: sql`department`, label: sql`department` },
    manager: { key: sql`manager_id::text`, label: sql`manager_name` },
  }[groupBy];
  // Authorized above: a masked actor's numbers are computed over everybody
  // and masked afterwards, as the executive summary does.
  const rows = await db.execute<GroupRow>(sql`
    with recursive ${scopedCtes(masked ? ALL_PEOPLE : actor, filters)}, ${sidesCte}
    select ${column.key} as key, ${column.label} as label,
           count(*)::int as participants,
           count(*) filter (where self_status = 'submitted')::int as self_submitted,
           count(*) filter (where self_status <> 'not_applicable')::int as self_applicable,
           count(*) filter (where manager_status = 'submitted')::int as manager_submitted,
           count(*) filter (where manager_status <> 'not_applicable')::int as manager_applicable,
           count(*) filter (where source = 'progress')::int as from_progress
    from sides
    group by 1, 2
    order by 2 nulls last, 1 nulls last`);
  const counts = (r: GroupRow): CompletionCounts => ({
    participants: r.participants,
    selfSubmitted: r.self_submitted,
    selfApplicable: r.self_applicable,
    managerSubmitted: r.manager_submitted,
    managerApplicable: r.manager_applicable,
  });
  const all = rows.reduce((sum, r) => add(sum, counts(r)), NONE);
  const fromProgress = rows.reduce((sum, r) => sum + r.from_progress, 0);
  const base = {
    cycleId: cycle.id,
    cycleName: cycle.name,
    groupBy,
    hierarchy,
    participants: all.participants,
  };
  const sources: Record<CompletionSource, number> = {
    progress: fromProgress,
    requests: all.participants - fromProgress,
  };

  if (!masked) {
    return {
      ...base,
      minGroupSize: null,
      total: withRates(null, null, all),
      groups:
        groupBy === "none"
          ? []
          : rows.map((r) => withRates(r.key, r.label, counts(r))),
      others: null,
      suppressed: 0,
      sources,
    };
  }

  const min = scope.minGroupSize;
  if (all.participants < min) {
    return {
      ...base,
      minGroupSize: min,
      total: null,
      groups: [],
      others: null,
      suppressed: all.participants,
      sources: { progress: 0, requests: 0 },
    };
  }
  const folded =
    groupBy === "none"
      ? { shown: [], others: null, suppressed: 0 }
      : foldSmallGroups(
          rows.map((r) => ({
            key: r.key,
            label: r.label,
            n: r.participants,
            mean: null,
            counts: toBins(counts(r)),
          })),
          min,
        );
  return {
    ...base,
    minGroupSize: min,
    total: withRates(null, null, all),
    groups: folded.shown.map((g) =>
      withRates(g.key, g.label, fromBins(g.n, g.counts)),
    ),
    others: folded.others
      ? withRates(null, null, fromBins(folded.others.n, folded.others.counts))
      : null,
    suppressed: folded.suppressed,
    sources,
  };
}

const MISSING: Record<MissingStatus, SQL> = {
  any: sql`(self_status in ('not_started', 'in_progress')
            or manager_status in ('not_started', 'in_progress'))`,
  self_missing: sql`self_status in ('not_started', 'in_progress')`,
  manager_missing: sql`manager_status in ('not_started', 'in_progress')`,
};

export type MissingFilters = {
  cycleId: string;
  department?: string;
  managerId?: string;
  /** Default: any side missing. */
  status?: MissingStatus;
  /** Default: the org as of the cycle snapshot. */
  hierarchy?: Hierarchy;
  /** Adds each person's work email; People only, ignored for anybody else. */
  includeEmail?: boolean;
};

/**
 * Who has not submitted a side of their assessment in a cycle (a side that
 * does not apply is not missing), by manager and then name. Names only for
 * People and for a manager (their direct reports); direction, who reads
 * aggregates, employees and a manager without a person are forbidden.
 */
export async function missingAssessments(
  db: DbOrTx,
  actor: ActorContext,
  f: MissingFilters,
): Promise<MissingPerson[]> {
  requirePeopleScope(actor);
  const cycle = await requireCycle(db, f.cycleId);
  const email = !!f.includeEmail && canSeeEmail(actor.role);
  const rows = await db.execute<{
    person_id: string;
    participant_id: string;
    name: string;
    department: string | null;
    manager_id: string | null;
    manager_name: string | null;
    self_status: SideStatus;
    manager_status: SideStatus;
    has_notes: boolean;
    source: CompletionSource;
    email: string | null;
  }>(sql`
    with recursive ${scopedCtes(actor, {
      cycleId: cycle.id,
      hierarchy: f.hierarchy ?? "asOf",
      department: f.department,
      managerId: f.managerId,
    })}, ${sidesCte}
    select sides.person_id, sides.participant_id, sides.name, sides.department,
           sides.manager_id, sides.manager_name, sides.self_status,
           sides.manager_status, sides.has_notes, sides.source,
           ${email ? sql`pe.work_email` : sql`null::text`} as email
    from sides
    ${email ? sql`join person pe on pe.id = sides.person_id` : sql``}
    where ${MISSING[f.status ?? "any"]}
    order by sides.manager_name nulls last, sides.name, sides.person_id`);
  return rows.map((r) => ({
    personId: r.person_id,
    participantId: r.participant_id,
    name: r.name,
    department: r.department,
    managerId: r.manager_id,
    managerName: r.manager_name,
    selfStatus: r.self_status,
    managerStatus: r.manager_status,
    hasFollowUpNotes: r.has_notes,
    source: r.source,
    ...(email ? { email: r.email } : {}),
  }));
}

/** The cycle before `cycleId` by period start (not deleted, not a draft). */
async function previousCycleId(
  db: DbOrTx,
  cycleId: string,
): Promise<string | null> {
  const [row] = await db.execute<{ id: string }>(sql`
    select p.id
    from review_cycle c
    join review_cycle p on p.period_start < c.period_start
      and p.deleted_at is null and p.status <> 'draft'
    where c.id = ${cycleId}::uuid
    order by p.period_start desc, p.period_end desc, p.name
    limit 1`);
  return row?.id ?? null;
}

const deltaRow = (
  current: CompletionGroup,
  previous: CompletionGroup | null | undefined,
): CompletionDeltaRow => ({
  key: current.key,
  label: current.label,
  selfDelta: deltaPoints(current.selfRate, previous?.selfRate ?? null),
  managerDelta: deltaPoints(current.managerRate, previous?.managerRate ?? null),
});

/**
 * The summary of a cycle next to the one of the previous semester cycle (the
 * launched, not deleted cycle with the latest earlier period start), with the
 * difference in percentage points per group (one decimal). A group has no
 * delta when the other cycle has no such group (for direction: no group that
 * reaches the minimum) or no rate to compare. Same authorization as
 * `completionSummary`.
 */
export async function completionDelta(
  db: DbOrTx,
  actor: ActorContext,
  f: CompletionFilters,
): Promise<CompletionDelta> {
  const minGroupSize =
    f.minGroupSize ??
    (actor.role === "direction" ? await minGroupSizeFor(db) : undefined);
  const current = await completionSummary(db, actor, { ...f, minGroupSize });
  const previousId = await previousCycleId(db, current.cycleId);
  const previous = previousId
    ? await completionSummary(db, actor, {
        ...f,
        cycleId: previousId,
        minGroupSize,
      })
    : null;
  const before = new Map((previous?.groups ?? []).map((g) => [g.key ?? "", g]));
  return {
    current,
    previous,
    total:
      current.total && previous?.total
        ? {
            selfDelta: deltaPoints(
              current.total.selfRate,
              previous.total.selfRate,
            ),
            managerDelta: deltaPoints(
              current.total.managerRate,
              previous.total.managerRate,
            ),
          }
        : null,
    groups: current.groups.map((g) => deltaRow(g, before.get(g.key ?? ""))),
    others:
      current.others && previous?.others
        ? deltaRow(current.others, previous.others)
        : null,
  };
}

/** The cycles the completion views can be opened on, latest period first. */
export async function completionCycles(db: DbOrTx): Promise<CompletionCycle[]> {
  return db
    .select({
      id: reviewCycle.id,
      name: reviewCycle.name,
      periodStart: reviewCycle.periodStart,
      periodEnd: reviewCycle.periodEnd,
      status: reviewCycle.status,
    })
    .from(reviewCycle)
    .where(and(isNull(reviewCycle.deletedAt), ne(reviewCycle.status, "draft")))
    .orderBy(
      desc(reviewCycle.periodStart),
      desc(reviewCycle.periodEnd),
      reviewCycle.name,
    );
}
