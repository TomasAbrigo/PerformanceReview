import type { LocalizedText } from "@/db/schema";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import type { Hierarchy } from "@/modules/analytics/dashboards/types";
import { ALL_PEOPLE, scopedCtes } from "@/modules/analytics/dashboards/scope";
import { type InsightsScope, insightsScope } from "@/modules/insights";
import { ReviewError } from "@/modules/review-core/review-errors";
import type { OrgDims } from "@/modules/org-attributes/kinds";
import { indicatorConfig } from "./config";
import type { Indicator, IndicatorConfig } from "./types";

/** What a request needs to know once: who reads, how far, with which thresholds. */
export type IndicatorContext = {
  actor: ActorContext;
  scope: Exclude<InsightsScope, { kind: "none" }>;
  config: IndicatorConfig;
};

/**
 * Authorizes the actor for the indicators (employees, also about themselves,
 * and a manager without a person are `forbidden`) and reads the thresholds
 * (settings, `override` on top).
 */
export async function indicatorContext(
  db: DbOrTx,
  actor: ActorContext,
  override?: Partial<IndicatorConfig>,
): Promise<IndicatorContext> {
  if (insightsScope(actor).kind === "none") throw new ReviewError("forbidden");
  const config = await indicatorConfig(db, override);
  const scope = insightsScope(actor, config.minGroupSize);
  if (scope.kind === "none") throw new ReviewError("forbidden");
  return { actor, scope, config };
}

export function requireUuid(id: string): string {
  if (!isUuid(id)) throw new ReviewError("not_found");
  return id;
}

/** `not_found` unless the cycle exists (and is not deleted). */
export async function requireCycle(db: DbOrTx, cycleId: string): Promise<void> {
  requireUuid(cycleId);
  const found = await db.execute(
    sql`select 1 from review_cycle where id = ${cycleId}::uuid and deleted_at is null`,
  );
  if (found.length === 0) throw new ReviewError("not_found");
}

/**
 * The cycle right before `cycleId` (order of period start, period end,
 * creation, id) that asks retention or engagement: the only baseline of a
 * drop (#133). Null for the first one.
 */
export async function previousIndicatorCycle(
  db: DbOrTx,
  cycleId: string,
): Promise<{ id: string; name: string; localizedName: LocalizedText | null } | null> {
  const rows = await db.execute<{
    id: string;
    name: string;
    localized_name: LocalizedText | null;
  }>(sql`
    select p.id, p.name, p.localized_name
    from review_cycle c
    join review_cycle p on p.deleted_at is null
      and (p.period_start, p.period_end, p.created_at, p.id::text)
        < (c.period_start, c.period_end, c.created_at, c.id::text)
    where c.id = ${requireUuid(cycleId)}::uuid
      and exists (
        select 1 from question_revision q
        where q.cycle_id = p.id and q.role in ('retention', 'engagement')
      )
    order by p.period_start desc, p.period_end desc, p.created_at desc,
             p.id::text desc
    limit 1`);
  const row = rows[0];
  return row
    ? { id: row.id, name: row.name, localizedName: row.localized_name }
    : null;
}

/**
 * One value (1-5) a manager gave a participant, with the participant's org
 * dimensions (and the org attributes People keep, as of the cycle snapshot).
 */
export type IndicatorRow = OrgDims & {
  participantId: string;
  cycleId: string;
  cycleName: string;
  periodStart: string;
  periodEnd: string;
  /** Epoch seconds: the last tie-break of the order of cycles. */
  cycleCreatedAt: number;
  personId: string;
  /** Empty when the reader may not name people (direction). */
  name: string;
  /** Per the hierarchy read: the cycle snapshot's, or today's. */
  department: string | null;
  managerId: string | null;
  managerName: string | null;
  indicator: Indicator;
  value: number;
};

type RawRow = {
  participant_id: string;
  cycle_id: string;
  cycle_name: string;
  period_start: string;
  period_end: string;
  cycle_created_at: number;
  person_id: string;
  name: string;
  department: string | null;
  manager_id: string | null;
  manager_name: string | null;
  account: string | null;
  project: string | null;
  dm: string | null;
  santex_lead: string | null;
  indicator: Indicator;
  value: number;
};

/**
 * The indicator rows the actor may read, of one cycle or of all. Built on the
 * dashboards' participant scope (`scopedCtes`: launched, not deleted cycles,
 * active participants, the org dimensions of the hierarchy) with the reach of
 * the indicators: a manager's direct reports of the snapshot, never themself;
 * direction is computed over everybody (it was authorized) and masked by the
 * callers, which also get no names.
 *
 * A row is the participant's answer to a question revision with the role
 * `retention` / `engagement` in their submitted manager review. If several
 * reviewers submitted, the latest review counts; if a review has several
 * revisions of the role (template groups) the lowest `sort` (then the
 * earliest, then the id) counts: one value per participant and indicator,
 * always the same.
 */
export async function loadRows(
  db: DbOrTx,
  ctx: IndicatorContext,
  f: {
    cycleId?: string;
    /** Only these cycles (the 360 view reads the latest few). */
    cycleIds?: readonly string[];
    hierarchy: Hierarchy;
  },
): Promise<IndicatorRow[]> {
  const runAs = ctx.scope.kind === "aggregatesOnly" ? ALL_PEOPLE : ctx.actor;
  const rows = await db.execute<RawRow>(sql`
    with recursive ${scopedCtes(
      runAs,
      { cycleId: f.cycleId, cycleIds: f.cycleIds, hierarchy: f.hierarchy },
      { snapshotScope: true },
    )},
    ind as (
      select distinct on (s.participant_id, q.role)
             s.participant_id, s.cycle_id, s.cycle_name, s.period_start,
             s.period_end, s.cycle_created_at, s.person_id, s.name,
             s.department, s.manager_id, s.manager_name,
             s.account, s.project, s.dm, s.santex_lead,
             q.role as indicator, a.option_value::int as value
      from scoped s
      join review_request r on r.participant_id = s.participant_id
        and r.relationship = 'manager' and r.status = 'submitted'
        and r.deleted_at is null
      join question_revision q on q.cycle_id = s.cycle_id
        and q.role in ('retention', 'engagement')
      join answer a on a.request_id = r.id and a.question_revision_id = q.id
        and a.option_value in (1, 2, 3, 4, 5)
      order by s.participant_id, q.role, r.submitted_at desc nulls last, r.id,
               q.sort, q.created_at, q.id
    )
    select * from ind`);
  const named = ctx.scope.kind !== "aggregatesOnly";
  return rows.map((r) => ({
    participantId: r.participant_id,
    cycleId: r.cycle_id,
    cycleName: r.cycle_name,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    cycleCreatedAt: r.cycle_created_at,
    personId: r.person_id,
    name: named ? r.name : "",
    department: r.department,
    managerId: r.manager_id,
    managerName: r.manager_name,
    account: r.account,
    project: r.project,
    dm: r.dm,
    santexLead: r.santex_lead,
    indicator: r.indicator,
    value: r.value,
  }));
}

/**
 * Whether `personId` is among the people the actor may read, in any cycle
 * (a manager: someone who reported to them in a launched cycle).
 */
export async function personInReach(
  db: DbOrTx,
  ctx: IndicatorContext,
  personId: string,
): Promise<boolean> {
  const runAs = ctx.scope.kind === "aggregatesOnly" ? ALL_PEOPLE : ctx.actor;
  const found = await db.execute(sql`
    with recursive ${scopedCtes(
      runAs,
      { hierarchy: "asOf" },
      { snapshotScope: true },
    )}
    select 1 from scoped where person_id = ${requireUuid(personId)}::uuid limit 1`);
  return found.length > 0;
}
