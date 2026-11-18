import { and, desc, isNull, ne, sql } from "drizzle-orm";
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
import { insightsScope } from "@/modules/insights/authz";
import type { OrgFilters } from "@/modules/org-attributes/kinds";
import { ReviewError } from "@/modules/review-core/review-errors";
import { getSetting } from "@/modules/settings/service";
import { missingOf, type SideRow, summarize } from "./derive";
import {
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
} from "./types";

export type CompletionFilters = OrgFilters & {
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
 * review requests: submitted if one is; otherwise in progress if a draft has
 * answers, not started if there are only drafts without answers or declined
 * requests (a declined request is not started even with answers), and not
 * applicable when there is no live request of that relationship. Superseded
 * and deleted requests do not count. Only runs for participants without an
 * `assessment_progress` row (`ap.id is null`: a one-time filter).
 */
const requestStatus = (relationship: "self" | "manager") => sql`
  select case
           when bool_or(r.status = 'submitted') then 'submitted'
           when count(*) = 0 then 'not_applicable'
           when bool_or(
                  r.status = 'draft'
                  and exists (select 1 from answer a where a.request_id = r.id)
                ) then 'in_progress'
           else 'not_started'
         end as status
  from review_request r
  where ap.id is null
    and r.participant_id = s.participant_id
    and r.relationship = ${relationship}
    and r.deleted_at is null and r.status <> 'superseded'`;

/**
 * CTE `sides` (over `scoped`): the standing of each participant's self and
 * manager assessment. The source is chosen per participant: their
 * `assessment_progress` row (Bamboo's Assessment Progress report) when there
 * is one, else what their review requests say.
 */
const sidesCte = sql`
  sides as (
    select s.participant_id, s.person_id, s.name, s.department,
           s.manager_id, s.manager_name,
           s.account, s.project, s.dm, s.santex_lead,
           case when ap.id is null then 'requests' else 'progress' end as source,
           coalesce(ap.self_status::text, rs.status) as self_status,
           coalesce(ap.manager_status::text, rm.status) as manager_status,
           coalesce(btrim(ap.follow_up_notes), '') <> '' as has_notes
    from scoped s
    left join assessment_progress ap on ap.participant_id = s.participant_id
    left join lateral (${requestStatus("self")}) rs on true
    left join lateral (${requestStatus("manager")}) rm on true
  )`;

/**
 * The participants in scope of `actor` with the standing of both sides of
 * their assessment, by manager (named ones first) and name. Authorization is
 * the caller's: `actor` is who `scopedCtes` restricts to.
 */
export async function loadSides(
  db: DbOrTx,
  actor: ActorContext,
  filters: DashboardFilters,
  { email }: { email: boolean },
): Promise<SideRow[]> {
  const rows = await db.execute<{
    person_id: string;
    participant_id: string;
    name: string;
    department: string | null;
    manager_id: string | null;
    manager_name: string | null;
    account: string | null;
    project: string | null;
    dm: string | null;
    santex_lead: string | null;
    self_status: SideStatus;
    manager_status: SideStatus;
    has_notes: boolean;
    source: CompletionSource;
    email: string | null;
  }>(sql`
    with recursive ${scopedCtes(actor, filters)}, ${sidesCte}
    select sides.person_id, sides.participant_id, sides.name, sides.department,
           sides.manager_id, sides.manager_name, sides.account, sides.project,
           sides.dm, sides.santex_lead, sides.self_status,
           sides.manager_status, sides.has_notes, sides.source,
           ${email ? sql`pe.work_email` : sql`null::text`} as email
    from sides
    ${email ? sql`join person pe on pe.id = sides.person_id` : sql``}
    order by sides.manager_name nulls last, sides.name, sides.person_id`);
  return rows.map((r) => ({
    participantId: r.participant_id,
    personId: r.person_id,
    name: r.name,
    department: r.department,
    managerId: r.manager_id,
    managerName: r.manager_name,
    account: r.account,
    project: r.project,
    dm: r.dm,
    santexLead: r.santex_lead,
    source: r.source,
    selfStatus: r.self_status,
    managerStatus: r.manager_status,
    hasNotes: r.has_notes,
    ...(email ? { email: r.email } : {}),
  }));
}

/** The filters People and managers may narrow by (direction has none). */
const orgScope = (
  f: OrgFilters & { department?: string; managerId?: string },
) => ({
  department: f.department,
  managerId: f.managerId,
  account: f.account,
  project: f.project,
  dm: f.dm,
  santexLead: f.santexLead,
});

/** A request, authorized and with its cycle looked up. */
type Resolved = {
  cycle: { id: string; name: string };
  /** Direction: aggregates only. */
  masked: boolean;
  minGroupSize: number | null;
  groupBy: CompletionGroupBy;
  hierarchy: Hierarchy;
  filters: DashboardFilters;
};

/** Direction's minimum group size: the override, else the setting. */
const minGroupSizeFor = async (db: DbOrTx, override?: number) =>
  override ?? (await getSetting(db, "aggregation.minGroupSize"));

/**
 * Who may read what: everybody in scope (People, a manager's direct reports)
 * or only aggregates (direction: teams without names, no filters). Anybody else is
 * forbidden. Then the cycle must exist.
 */
async function resolve(
  db: DbOrTx,
  actor: ActorContext,
  f: CompletionFilters,
): Promise<Resolved> {
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
  return {
    cycle,
    masked,
    minGroupSize: scope.kind === "aggregatesOnly" ? scope.minGroupSize : null,
    // Direction may group by manager too: a team, never a name (`summarize`).
    groupBy: f.groupBy ?? "department",
    hierarchy,
    filters: {
      cycleId: cycle.id,
      hierarchy,
      ...(masked ? {} : orgScope(f)),
    },
  };
}

function summaryOf(r: Resolved, rows: SideRow[]): CompletionSummary {
  return {
    cycleId: r.cycle.id,
    cycleName: r.cycle.name,
    hierarchy: r.hierarchy,
    ...summarize(rows, { groupBy: r.groupBy, minGroupSize: r.minGroupSize }),
  };
}

/**
 * Completion of a cycle: how many participants submitted their self and their
 * manager assessment, all together or by department or manager (of the
 * snapshot, or today's: `hierarchy`). Percentages are over the participants
 * the side applies to (`not_applicable` sides are out). Statuses come from
 * each participant's `assessment_progress` row when they have one, else from
 * their review requests (see `sidesCte`).
 *
 * People read everything and a manager their direct reports; direction only
 * aggregates: no filters, no names (a team keeps its manager's `key` but has
 * no `label`), groups under the minimum group size folded into "Otros" (or
 * hidden if that is under it too), and a cycle with fewer participants than
 * that shows only its head count. Employees (and a
 * manager acting without a person) are forbidden.
 */
export async function completionSummary(
  db: DbOrTx,
  actor: ActorContext,
  f: CompletionFilters,
): Promise<CompletionSummary> {
  const r = await resolve(db, actor, f);
  // Authorized above: a masked actor's numbers are computed over everybody
  // and masked afterwards, as the executive summary does.
  const rows = await loadSides(db, r.masked ? ALL_PEOPLE : actor, r.filters, {
    email: false,
  });
  return summaryOf(r, rows);
}

export type MissingFilters = OrgFilters & {
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

const personOf = (cycleName: string, r: SideRow): MissingPerson => ({
  cycleName,
  personId: r.personId,
  participantId: r.participantId,
  name: r.name,
  department: r.department,
  managerId: r.managerId,
  managerName: r.managerName,
  selfStatus: r.selfStatus,
  managerStatus: r.managerStatus,
  hasFollowUpNotes: r.hasNotes,
  source: r.source,
  ...(r.email !== undefined ? { email: r.email } : {}),
});

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
  const rows = await loadSides(
    db,
    actor,
    {
      cycleId: cycle.id,
      hierarchy: f.hierarchy ?? "asOf",
      ...orgScope(f),
    },
    { email: !!f.includeEmail && canSeeEmail(actor.role) },
  );
  return missingOf(rows, f.status).map((r) => personOf(cycle.name, r));
}

/**
 * The cycle before `cycleId` in the order of `completionCycles` (period
 * start, period end, creation, id), so cycles of the same period are each
 * other's predecessors; not deleted, not a draft.
 */
async function previousCycleId(
  db: DbOrTx,
  cycleId: string,
): Promise<string | null> {
  const [row] = await db.execute<{ id: string }>(sql`
    select p.id
    from review_cycle c
    join review_cycle p
      on (p.period_start, p.period_end, p.created_at, p.id)
       < (c.period_start, c.period_end, c.created_at, c.id)
      and p.deleted_at is null and p.status <> 'draft'
    where c.id = ${cycleId}::uuid
    order by p.period_start desc, p.period_end desc, p.created_at desc, p.id desc
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

function deltaOf(
  current: CompletionSummary,
  previous: CompletionSummary | null,
): CompletionDelta {
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

/** The current cycle's rows, read once, and the delta against the cycle before. */
async function overview(db: DbOrTx, actor: ActorContext, f: CompletionFilters) {
  const minGroupSize =
    f.minGroupSize ??
    (actor.role === "direction" ? await minGroupSizeFor(db) : undefined);
  const r = await resolve(db, actor, { ...f, minGroupSize });
  const rows = await loadSides(db, r.masked ? ALL_PEOPLE : actor, r.filters, {
    email: false,
  });
  const current = summaryOf(r, rows);
  const previousId = await previousCycleId(db, r.cycle.id);
  const previous = previousId
    ? await completionSummary(db, actor, {
        ...f,
        cycleId: previousId,
        minGroupSize,
      })
    : null;
  return { r, rows, delta: deltaOf(current, previous) };
}

/**
 * The summary of a cycle next to the one of the previous semester cycle (see
 * `previousCycleId`), with the difference in percentage points per group (one
 * decimal). A group has no delta when the other cycle has no such group (for
 * direction: no group that reaches the minimum) or no rate to compare. Same
 * authorization as `completionSummary`.
 */
export async function completionDelta(
  db: DbOrTx,
  actor: ActorContext,
  f: CompletionFilters,
): Promise<CompletionDelta> {
  return (await overview(db, actor, f)).delta;
}

/**
 * What the completion page shows: the delta and, for whoever may name people,
 * the "quién falta" list, both read off the same rows of the current cycle
 * (loaded once). `missing` is null for direction, who reads aggregates only.
 */
export async function completionOverview(
  db: DbOrTx,
  actor: ActorContext,
  f: CompletionFilters & { missingStatus?: MissingStatus },
): Promise<{ delta: CompletionDelta; missing: MissingPerson[] | null }> {
  const { r, rows, delta } = await overview(db, actor, f);
  return {
    delta,
    missing: r.masked
      ? null
      : missingOf(rows, f.missingStatus).map((row) =>
          personOf(r.cycle.name, row),
        ),
  };
}

/**
 * The cycles the completion views can be opened on, latest first, in the
 * total order `previousCycleId` follows: period start, period end, creation
 * and id.
 */
export async function completionCycles(db: DbOrTx): Promise<CompletionCycle[]> {
  return db
    .select({
      id: reviewCycle.id,
      name: reviewCycle.name,
      localizedName: reviewCycle.localizedName,
      periodStart: reviewCycle.periodStart,
      periodEnd: reviewCycle.periodEnd,
      status: reviewCycle.status,
    })
    .from(reviewCycle)
    .where(and(isNull(reviewCycle.deletedAt), ne(reviewCycle.status, "draft")))
    .orderBy(
      desc(reviewCycle.periodStart),
      desc(reviewCycle.periodEnd),
      desc(reviewCycle.createdAt),
      desc(reviewCycle.id),
    );
}
