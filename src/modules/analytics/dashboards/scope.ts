import { type SQL, sql } from "drizzle-orm";
import { isUuid } from "@/lib/uuid";
import { isHr } from "@/modules/actor/access";
import type { ActorContext } from "@/modules/actor/types";
import { type InsightsScope, insightsScope } from "@/modules/insights/authz";
import { ReviewError } from "@/modules/review-core/review-errors";
import type { DashboardFilters } from "./types";

export { isHr };

/** The scope of the dashboards that name people: People or a manager. */
export type PeopleScope = Extract<
  InsightsScope,
  { kind: "all" | "directReports" }
>;

/**
 * What the actor may read of the dashboards that name people (everything but
 * the executive view): People all, a manager their direct reports; anyone
 * else, direction included (aggregates only), is forbidden.
 */
export function requirePeopleScope(actor: ActorContext): PeopleScope {
  const scope = insightsScope(actor);
  if (scope.kind === "all" || scope.kind === "directReports") return scope;
  throw new ReviewError("forbidden");
}

/**
 * The actor the aggregate queries run as inside the executive summary, after
 * it authorized the real one: whatever the actor is allowed to see there is
 * computed over everybody and masked afterwards (see `executiveSummary`).
 */
export const ALL_PEOPLE: ActorContext = { personId: null, role: "hr" };

/** A job_history row (alias h) valid on `date`. */
const validOn = (date: SQL) =>
  sql`h.deleted_at is null and h.valid_from <= ${date} and (h.valid_to is null or h.valid_to > ${date})`;

/**
 * Subtree of `rootId` on `date` (recursive CTE over job history): rows
 * (person_id, depth), depth 1 = direct reports. Use as a CTE body.
 */
export const subtree = (rootId: string, date: SQL) => sql`
  select h.person_id, 1 as depth, array[h.person_id] as ids
  from employee_job_history h
  where h.manager_person_id = ${rootId}::uuid and ${validOn(date)}
  union all
  select h.person_id, s.depth + 1, s.ids || h.person_id
  from sub s join employee_job_history h on h.manager_person_id = s.person_id and ${validOn(date)}
  where not h.person_id = any(s.ids) and s.depth < 50`;

/**
 * CTEs `cur` (current job row per person) and `scoped`: active participants
 * of launched cycles with their org dimensions per hierarchy (snapshot or
 * current), filtered and restricted to what the actor may see (see
 * `requirePeopleScope`). Columns:
 * participant_id, cycle_id, person_id, name, department, manager_id,
 * manager_name, location, job_title, published.
 */
export function scopedCtes(actor: ActorContext, f: DashboardFilters): SQL {
  const asOf = f.hierarchy === "asOf";
  const dim = (snap: string, cur: string) =>
    sql.raw(asOf ? `cp.${snap}` : `cur.${cur}`);
  const department = dim("snap_department", "department");
  const manager = dim("snap_manager_person_id", "manager_person_id");
  const location = dim("snap_location", "location");
  const jobTitle = dim("snap_job_title", "job_title");
  const where: SQL[] = [sql`cp.removed_at is null`, sql`c.status <> 'draft'`];
  if (f.cycleId) {
    if (!isUuid(f.cycleId)) throw new ReviewError("not_found");
    where.push(sql`cp.cycle_id = ${f.cycleId}::uuid`);
  }
  if (f.department) where.push(sql`${department} = ${f.department}`);
  if (f.location) where.push(sql`${location} = ${f.location}`);
  if (f.jobTitle) where.push(sql`${jobTitle} = ${f.jobTitle}`);
  if (f.managerId && isUuid(f.managerId)) {
    where.push(sql`${manager} = ${f.managerId}::uuid`);
  }
  const scope = requirePeopleScope(actor);
  if (scope.kind === "directReports") {
    // Direct reports only: the snapshot manager (asOf) or today's (current),
    // never the whole chain below the manager.
    where.push(sql`${manager} = ${scope.managerPersonId}::uuid`);
  }
  return sql`
    cur as (
      select distinct on (h.person_id) h.person_id, h.manager_person_id,
             h.department, h.location, h.job_title
      from employee_job_history h
      where h.deleted_at is null and h.valid_to is null
      order by h.person_id, h.valid_from desc
    ),
    scoped as (
      select cp.id as participant_id, cp.cycle_id, cp.reviewee_person_id as person_id,
             rp.display_name as name, ${department} as department,
             ${manager} as manager_id, mp.display_name as manager_name,
             ${location} as location, ${jobTitle} as job_title,
             c.calibration_published_at is not null as published
      from cycle_participant cp
      join review_cycle c on c.id = cp.cycle_id
      join person rp on rp.id = cp.reviewee_person_id
      left join cur on cur.person_id = cp.reviewee_person_id
      left join person mp on mp.id = ${manager}
      where ${sql.join(where, sql` and `)}
    )`;
}

/** CTE `rating`: (participant_id, normalized) for the given stage. */
export const ratingCte = (stage: "manager" | "current") =>
  stage === "current"
    ? sql`rating as (
        select participant_id, normalized::float8 as normalized
        from v_current_rating where normalized is not null
      )`
    : sql`rating as (
        select distinct on (participant_id) participant_id, normalized::float8 as normalized
        from final_rating where stage = 'manager' and normalized is not null
        order by participant_id, created_at desc
      )`;
