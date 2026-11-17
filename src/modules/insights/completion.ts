import { type SQL, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { isUuid } from "@/lib/uuid";
import { ReviewError } from "@/modules/review-core/review-errors";
import { foldSmallGroups } from "./aggregation";
import type { InsightsScope } from "./authz";

// Minimal FALLBACK for completion until the analytics completion module (#59)
// lands: one function, so switching to it is replacing this file's callers.

export type Ratio = { submitted: number; total: number };

export type CompletionGroup = {
  /** Department, manager person id, or null (everybody / no department). */
  key: string | null;
  /** What to show for the key (the manager's name), null for "everybody". */
  label: string | null;
  /** Participants of the group. */
  n: number;
  self: Ratio;
  manager: Ratio;
};

export type Completion = {
  groups: CompletionGroup[];
  /** Groups under the minimum folded together (direction); null when none. */
  others: Omit<CompletionGroup, "key" | "label"> | null;
  /** Everybody in reach; null when direction cannot see it (under the minimum). */
  total: CompletionGroup | null;
  /** People left out of the breakdown (direction, groups under the minimum). */
  suppressed: number;
  /** The minimum group size applied (direction), else null. */
  minGroupSize: number | null;
};

export type CompletionGroupBy = "department" | "manager" | "none";

/**
 * Self and manager assessments submitted vs expected per participant of a
 * cycle, grouped. Bamboo's Assessment Progress report (`assessment_progress`)
 * is the truth where it has the participant (`not_applicable` is not
 * expected); otherwise the review requests say it: a submitted request of the
 * relationship counts as done, and each participant is expected one of every
 * component the cycle has. Scope as insightsScope: People all, a manager the
 * direct reports of the snapshot, direction groups of at least the minimum
 * (smaller ones folded with foldSmallGroups), an employee forbidden.
 */
export async function completion(
  db: DbOrTx,
  scope: InsightsScope,
  f: { cycleId: string; groupBy: CompletionGroupBy },
): Promise<Completion> {
  if (scope.kind === "none") throw new ReviewError("forbidden");
  if (!isUuid(f.cycleId)) throw new ReviewError("not_found");
  const where: SQL[] = [
    sql`cp.removed_at is null`,
    sql`cp.cycle_id = ${f.cycleId}::uuid`,
  ];
  if (scope.kind === "directReports") {
    where.push(
      sql`cp.snap_manager_person_id = ${scope.managerPersonId}::uuid`,
      sql`cp.reviewee_person_id <> ${scope.managerPersonId}::uuid`,
    );
  }
  const key =
    f.groupBy === "department"
      ? sql`cp.snap_department`
      : f.groupBy === "manager"
        ? sql`cp.snap_manager_person_id::text`
        : sql`null::text`;
  const label = f.groupBy === "manager" ? sql`mp.display_name` : sql`${key}`;
  const side = (rel: "self" | "manager") => {
    const status = sql.raw(`ap.${rel}_status`);
    const component = sql.raw(`'${rel}'`);
    return {
      done: sql`case when ap.id is not null then ${status} = 'submitted'
        else exists (select 1 from review_request r where r.participant_id = cp.id
          and r.relationship = ${component} and r.status = 'submitted' and r.deleted_at is null) end`,
      expected: sql`case when ap.id is not null then ${status} <> 'not_applicable'
        else coalesce((c.components ->> ${component})::boolean, false) end`,
    };
  };
  const self = side("self");
  const manager = side("manager");
  const rows = await db.execute<{
    key: string | null;
    label: string | null;
    n: number;
    self_done: number;
    self_total: number;
    manager_done: number;
    manager_total: number;
  }>(sql`
    with p as (
      select ${key} as key, ${label} as label,
             (${self.done})::int as self_done, (${self.expected})::int as self_total,
             (${manager.done})::int as manager_done, (${manager.expected})::int as manager_total
      from cycle_participant cp
      join review_cycle c on c.id = cp.cycle_id
      left join person mp on mp.id = cp.snap_manager_person_id
      left join assessment_progress ap on ap.participant_id = cp.id and ap.cycle_id = cp.cycle_id
      where ${sql.join(where, sql` and `)}
    )
    select key, min(label) as label, count(*)::int as n,
           sum(self_done)::int as self_done, sum(self_total)::int as self_total,
           sum(manager_done)::int as manager_done, sum(manager_total)::int as manager_total
    from p group by key order by min(label) nulls last, key`);

  const cells = rows.map((r) => ({
    key: r.key,
    label: r.label,
    n: r.n,
    mean: null,
    counts: [r.self_done, r.self_total, r.manager_done, r.manager_total],
  }));
  const asGroup = (c: {
    n: number;
    counts: number[];
  }): Omit<CompletionGroup, "key" | "label"> => ({
    n: c.n,
    self: { submitted: c.counts[0], total: c.counts[1] },
    manager: { submitted: c.counts[2], total: c.counts[3] },
  });
  const sum = cells.reduce(
    (acc, c) => ({
      n: acc.n + c.n,
      counts: acc.counts.map((v, i) => v + c.counts[i]),
    }),
    { n: 0, counts: [0, 0, 0, 0] },
  );
  const min = scope.kind === "aggregatesOnly" ? scope.minGroupSize : null;
  const total =
    sum.n > 0 && (min === null || sum.n >= min)
      ? { key: null, label: null, ...asGroup(sum) }
      : null;
  if (f.groupBy === "none") {
    return {
      groups: [],
      others: null,
      total,
      suppressed: 0,
      minGroupSize: min,
    };
  }
  if (min === null) {
    return {
      groups: cells.map((c) => ({ key: c.key, label: c.label, ...asGroup(c) })),
      others: null,
      total,
      suppressed: 0,
      minGroupSize: null,
    };
  }
  const folded = foldSmallGroups(cells, min);
  return {
    groups: folded.shown.map((c) => ({
      key: c.key,
      label: c.label,
      ...asGroup(c),
    })),
    others: folded.others ? asGroup(folded.others) : null,
    total,
    suppressed: folded.suppressed,
    minGroupSize: min,
  };
}
