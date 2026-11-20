import { type SQL, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { insightsScope, type InsightsScope } from "@/modules/insights/authz";
import { withoutPersonFilters } from "@/modules/org-attributes/kinds";
import {
  orgAttributeColumns,
  orgAttributeFilters,
  orgAttributeJoins,
} from "@/modules/org-attributes/sql";
import { managerMayReadSql } from "@/modules/review-core/visibility-sql";
import { getSetting } from "@/modules/settings/service";
import { analysisTextSql } from "./analysis-text";
import { effectiveCte } from "./effective";
import { AnalysisError } from "./errors";
import type { QualitativeFilters } from "./types";

/**
 * The scope of every qualitative reader (#129), one place:
 *
 * - Who sees what (insightsScope): People everything; a manager what is
 *   about their direct reports at the cycle snapshot, never a self review
 *   the double blind still keeps from them (managerMayReadSql, the rule
 *   /assessments shows as "Reservada"); direction aggregates only, over at
 *   least `aggregation.minGroupSize` DISTINCT PEOPLE: a group under it is
 *   left out, and filters that select a universe under it return nothing;
 *   an employee nothing. aggregateOnly (also People's toggle) keeps counts
 *   and drops comments and quotes.
 * - The unit is the person (`person_id` = cycle_participant.
 *   reviewee_person_id): every "N personas" and every minimum count
 *   distinct people, never participations or answers.
 */
export type Resolved = {
  scope: InsightsScope;
  f: QualitativeFilters;
  /** Direction's minimum of distinct people per group; 0 for the rest. */
  min: number;
};

async function scopeOf(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<Resolved | null> {
  const scope = insightsScope(
    actor,
    actor.role === "direction"
      ? (f.minGroupSize ?? (await getSetting(db, "aggregation.minGroupSize")))
      : undefined,
  );
  if (scope.kind === "none") return null;
  if (scope.kind === "aggregatesOnly") {
    return {
      scope,
      // Direction does not filter by the people who lead a team (DM, Santex Lead).
      f: { ...withoutPersonFilters(f, true), aggregateOnly: true },
      min: scope.minGroupSize,
    };
  }
  return { scope, f, min: 0 };
}

/** The actor's scope for `f`; null when they read nothing (or direction under the minimum). */
export async function resolve(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<Resolved | null> {
  const r = await scopeOf(db, actor, f);
  if (!r) return null;
  // A filter cannot narrow direction below the minimum: under it, nothing.
  if (r.min > 1 && (await universeOf(db, r)) < r.min) return null;
  return r;
}

/**
 * FROM + WHERE of the submitted answers in scope (aliases a, q, r, cp, c, p
 * and the org attributes; `join` adds joins before the WHERE): the cycle,
 * area, org cuts, side and indicator filters, and the actor's reach. Shared
 * by the labels (`labeledCtes`) and the closed and yes/no answers alike.
 */
export function scopedAnswersSql(
  { scope, f }: Resolved,
  join: SQL = sql``,
): SQL {
  const where: SQL[] = [
    sql`r.deleted_at is null`,
    sql`r.status = 'submitted'`,
    sql`cp.removed_at is null`,
  ];
  if (f.cycleId) {
    if (!isUuid(f.cycleId)) throw new AnalysisError("not_found");
    where.push(sql`r.cycle_id = ${f.cycleId}::uuid`);
  }
  if (f.cycleIds) {
    const ids = f.cycleIds.map((id) => {
      if (!isUuid(id)) throw new AnalysisError("not_found");
      return sql`${id}::uuid`;
    });
    where.push(
      ids.length ? sql`r.cycle_id in (${sql.join(ids, sql`, `)})` : sql`false`,
    );
  }
  if (f.department) where.push(sql`cp.snap_department = ${f.department}`);
  where.push(...orgAttributeFilters(f));
  if (f.relationship) where.push(sql`r.relationship = ${f.relationship}`);
  if (f.indicator) {
    const value = Number(f.indicator.value);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new AnalysisError("not_found");
    }
    where.push(sql`(
      select ia.option_value::int
      from answer ia
      join review_request ir on ir.id = ia.request_id
      join question_revision iq on iq.id = ia.question_revision_id
      where ir.participant_id = cp.id and iq.role::text = ${f.indicator.role}
        and ia.option_value in (1, 2, 3, 4, 5)
        and ir.relationship = 'manager' and ir.status = 'submitted'
        and ir.deleted_at is null
      order by ir.submitted_at desc nulls last, ir.id
      limit 1
    ) = ${value}`);
  }
  if (scope.kind === "directReports") {
    where.push(
      sql`cp.snap_manager_person_id = ${scope.managerPersonId}::uuid`,
      sql`cp.reviewee_person_id <> ${scope.managerPersonId}::uuid`,
      managerMayReadSql("r", "cp", "c"),
    );
  }
  return sql`from answer a
      join question_revision q on q.id = a.question_revision_id
      join review_request r on r.id = a.request_id
      join cycle_participant cp on cp.id = r.participant_id
      join review_cycle c on c.id = r.cycle_id
      join person p on p.id = cp.reviewee_person_id
      ${orgAttributeJoins("cp", sql`cp.snapshot_as_of`)}
      ${join}
      where ${sql.join(where, sql` and `)}`;
}

/** Distinct people with a submitted answer in the scope of `r`. */
async function universeOf(db: DbOrTx, r: Resolved): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`
    select count(distinct cp.reviewee_person_id)::int as n
    ${scopedAnswersSql(r)}`);
  return row?.n ?? 0;
}

export type Universe = {
  /** Distinct people the filters select; null when masked. */
  people: number | null;
  /** Direction under the minimum (or no reach): show the masked state. */
  masked: boolean;
  /** Direction's minimum, else null. */
  minGroupSize: number | null;
};

/**
 * How many distinct people the filters select, and whether the actor may see
 * figures about them: direction under the minimum gets `masked` and no
 * number (the page shows the masked state instead of the panels).
 */
export async function qualitativeUniverse(
  db: DbOrTx,
  actor: ActorContext,
  f: QualitativeFilters,
): Promise<Universe> {
  const r = await scopeOf(db, actor, f);
  if (!r) return { people: null, masked: true, minGroupSize: null };
  const people = await universeOf(db, r);
  const minGroupSize = r.min > 0 ? r.min : null;
  if (r.min > 1 && people < r.min) {
    return { people: null, masked: true, minGroupSize };
  }
  return { people, masked: false, minGroupSize };
}

/** Groups with fewer distinct PEOPLE than `min` are left out. */
export const minGroup = (min: number, col = sql`person_id`) =>
  min > 1 ? sql`having count(distinct ${col}) >= ${min}` : sql``;

/**
 * CTEs eff + labeled: the effective labels (free text only, #128) of the
 * submitted answers in scope, with who they are about (`person_id`, the
 * unit of every count) and which side wrote them (`relationship`).
 */
export function labeledCtes(r: Resolved): SQL {
  const { f } = r;
  const where: SQL[] = [sql`true`];
  if (f.dimension) where.push(sql`eff.dimension = ${f.dimension}`);
  if (f.sentiment) where.push(sql`eff.sentiment = ${f.sentiment}`);
  if (f.theme) where.push(sql`${f.theme} = any(eff.themes)`);
  if (f.substance) where.push(sql`eff.substance = ${f.substance}`);
  if (f.signal) where.push(sql`${f.signal} = any(eff.signals)`);
  return sql`${effectiveCte()},
    labeled as (
      select eff.*, ${analysisTextSql("a", "q")} as text, r.cycle_id,
             q.kind::text as question_kind,
             r.relationship::text as relationship,
             c.name as cycle_name, c.period_start::text as period_start,
             c.period_end::text as period_end,
             cp.id as participant_id, cp.reviewee_person_id as person_id,
             p.display_name as person_name,
             cp.snap_department as department, ${orgAttributeColumns}
      ${scopedAnswersSql(r, sql`join eff on eff.answer_id = a.id`)}
        and ${sql.join(where, sql` and `)}
    )`;
}
