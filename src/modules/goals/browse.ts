import { type SQL, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { LocalizedText } from "@/db/schema/rating-scales";
import type { GoalStatus } from "@/db/schema/goals";
import { iso } from "@/modules/api/queries/shared";
import { clampPage, MAX_PAGE } from "@/lib/paging";
import { allOf, containsPattern, jobValidOn, rowsOf } from "@/lib/sql";
import { isUuid } from "@/lib/uuid";
import {
  type IndividualScope,
  individualScope,
} from "@/modules/actor/individual-scope";
import type { ActorContext } from "@/modules/actor/types";
import {
  type OrgFilters,
  type OrgOptions,
  orgOptionsOf,
} from "@/modules/org-attributes/kinds";
import {
  orgAttributeColumns,
  orgAttributeFilters,
  orgAttributeJoins,
} from "@/modules/org-attributes/sql";
import { todayLocal } from "@/modules/org-history/dates";
import { ReviewError } from "@/modules/review-core/review-errors";
import { cycleGoalAsOf } from "./as-of";
import { type GoalState, goalState } from "./state";

/**
 * The goals screens (Goals area): the list and the detail of a goal, for the
 * people who follow them, never the analysis (that is modules/analytics).
 *
 * Who reads what (`individualScope`): People every goal; a manager the goals
 * of their direct reports today (and their own); an employee only their own;
 * direction and an actor without a person none (`forbidden`). One condition,
 * `scopeCondition`, is used by the list, the options and the detail so they
 * can never disagree.
 */

export const GOALS_PAGE_SIZE = 25;

export type GoalListFilters = OrgFilters & {
  /** Goals in the participants' snapshot of this cycle (the "goals of the period"). */
  cycleId?: string;
  state?: GoalState;
  /** Part of the owner's name or of the goal's title. */
  q?: string;
  /** The owner's area today. */
  department?: string;
  /** 1-based. */
  page?: number;
};

export type GoalListItem = {
  id: string;
  title: string;
  status: GoalStatus;
  /** `overdue` when in progress past its due date. */
  state: GoalState;
  percentComplete: number;
  dueDate: string | null;
  completionDate: string | null;
  person: { id: string; name: string };
  department: string | null;
  milestonesTotal: number;
  milestonesDone: number;
};

export type GoalListPage = {
  items: GoalListItem[];
  /** Goals matching every filter. */
  total: number;
  /**
   * Per state, ignoring the state filter (the chips above the list). A
   * partition: the four add up to the goals of the filtered set.
   */
  counts: Record<GoalState, number>;
  /**
   * The date "overdue" is measured at (yyyy-mm-dd): today, or, for the goals
   * of a closed cycle (`cycleId`), the end of its period (`goalAsOf`).
   */
  asOf: string;
  /**
   * The goals of the filtered set due on or before `asOf`, and the completed
   * ones among them: the base of a completion rate shown against a target (a
   * goal not due yet is not a failure).
   */
  due: { total: number; completed: number };
  page: number;
  pageSize: number;
};

export type GoalFilterOptions = {
  departments: string[];
  org: OrgOptions;
};

/** The condition that limits the goals `g` (with its owner's current job `j`) to the scope. */
function scopeCondition(scope: IndividualScope): SQL {
  switch (scope.kind) {
    case "all":
      return sql`true`;
    case "team":
      return sql`(g.person_id = ${scope.personId}::uuid or j.manager_person_id = ${scope.personId}::uuid)`;
    case "own":
      return sql`g.person_id = ${scope.personId}::uuid`;
    case "none":
      throw new ReviewError("forbidden");
  }
}

/** `from goal g ...` with the owner, their job and org attributes of `today`. */
const goalsFrom = (today: string): SQL => sql`
  from goal g
  join person p on p.id = g.person_id
  left join lateral (
    select h.department, h.manager_person_id
    from employee_job_history h
    where h.person_id = g.person_id and ${jobValidOn("h", today)}
    order by h.valid_from desc, h.id
    limit 1
  ) j on true
  ${orgAttributeJoins("g", sql`${today}::date`, "person_id")}`;

const stateExpr = (today: string): SQL =>
  sql`(case when g.status = 'in_progress' and g.due_date is not null and g.due_date < ${today}::date then 'overdue' else g.status::text end)`;

/** Conditions of every filter but the state (the chips count over these). */
function filterConditions(f: GoalListFilters): SQL[] {
  const where: SQL[] = [];
  if (f.cycleId) {
    where.push(
      isUuid(f.cycleId)
        ? sql`exists (
            select 1 from participant_goal_snapshot s
            join cycle_participant cp on cp.id = s.participant_id
            where s.goal_id = g.id and cp.cycle_id = ${f.cycleId}::uuid
              and cp.removed_at is null and not s.no_longer_applicable
          )`
        : sql`false`,
    );
  }
  if (f.q?.trim()) {
    const pattern = containsPattern(f.q.trim());
    where.push(
      sql`(p.display_name ilike ${pattern} or g.title ilike ${pattern})`,
    );
  }
  if (f.department) where.push(sql`j.department = ${f.department}`);
  where.push(...orgAttributeFilters(f));
  return where;
}

type ListRow = {
  id: string;
  title: string;
  status: GoalStatus;
  percentComplete: number;
  dueDate: string | null;
  completionDate: string | null;
  personId: string;
  personName: string;
  department: string | null;
  milestonesTotal: number;
  milestonesDone: number;
};

/**
 * A page of the goals `actor` may read, most urgent first (state: overdue,
 * in progress, completed, closed; then due date, owner and title), with the
 * counts per state of the filtered set. The state of a goal is read at the
 * cycle's reference date when the list is the goals of a cycle (`cycleId`):
 * the same rule, and the same numbers, as the goal analytics.
 */
export async function listGoals(
  db: DbOrTx,
  actor: ActorContext,
  filters: GoalListFilters = {},
  today: string = todayLocal(),
): Promise<GoalListPage> {
  const scope = individualScope(actor);
  const asOf =
    (filters.cycleId
      ? await cycleGoalAsOf(db, filters.cycleId, today)
      : null) ?? today;
  const base = allOf([
    sql`g.deleted_at is null`,
    scopeCondition(scope),
    ...filterConditions(filters),
  ]);
  const state = sql`${stateExpr(asOf)}`;
  const where = allOf([
    base,
    filters.state ? sql`${state} = ${filters.state}` : sql`true`,
  ]);
  const pageSize = GOALS_PAGE_SIZE;
  const readPage = async (page: number) =>
    rowsOf<ListRow>(
      await db.execute(sql`
        select g.id, g.title, g.status::text as status,
          g.percent_complete as "percentComplete",
          g.due_date::text as "dueDate", g.completion_date::text as "completionDate",
          g.person_id as "personId", p.display_name as "personName",
          j.department,
          (select count(*)::int from goal_milestone m
            where m.goal_id = g.id and m.deleted_at is null) as "milestonesTotal",
          (select count(*)::int from goal_milestone m
            where m.goal_id = g.id and m.deleted_at is null
              and m.completed_at is not null) as "milestonesDone"
        ${goalsFrom(today)}
        where ${where}
        order by (case ${state} when 'overdue' then 0 when 'in_progress' then 1
            when 'completed' then 2 else 3 end),
          g.due_date nulls last, p.display_name, g.title, g.id
        limit ${pageSize} offset ${(page - 1) * pageSize}`),
    );

  // The counts and the page read together; a page past the last one is
  // clamped to it (read again, the rare case).
  const requested = clampPage(filters.page, MAX_PAGE * pageSize, pageSize);
  const [counted, firstTry] = await Promise.all([
    db.execute(sql`
      select ${state} as state, count(*)::int as n,
        count(*) filter (where g.due_date <= ${asOf}::date)::int as due
      ${goalsFrom(today)}
      where ${base}
      group by 1`),
    readPage(requested),
  ]);
  const counts: Record<GoalState, number> = {
    in_progress: 0,
    completed: 0,
    closed: 0,
    overdue: 0,
  };
  const due = { total: 0, completed: 0 };
  for (const row of rowsOf<{ state: GoalState; n: number; due: number }>(
    counted,
  )) {
    counts[row.state] = row.n;
    due.total += row.due;
    if (row.state === "completed") due.completed = row.due;
  }
  const total = filters.state
    ? counts[filters.state]
    : Object.values(counts).reduce((a, b) => a + b, 0);
  const page = clampPage(requested, total, pageSize);
  const rows = page === requested ? firstTry : await readPage(page);
  return {
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      state: goalState(r, asOf),
      percentComplete: r.percentComplete,
      dueDate: r.dueDate,
      completionDate: r.completionDate,
      person: { id: r.personId, name: r.personName },
      department: r.department,
      milestonesTotal: r.milestonesTotal,
      milestonesDone: r.milestonesDone,
    })),
    total,
    counts,
    asOf,
    due,
    page,
    pageSize,
  };
}

/** A cycle that has goals in the actor's scope, for the cycle filter. */
export type GoalCycle = {
  id: string;
  name: string;
  localizedName: LocalizedText | null;
  periodEnd: string;
};

/**
 * The launched cycles whose snapshot holds goals `actor` may read, latest
 * period first: the options of the cycle filter, by the same scope rule as the
 * list itself (a cycle never offers a filter that comes back empty for them).
 */
export async function listGoalCycles(
  db: DbOrTx,
  actor: ActorContext,
  today: string = todayLocal(),
): Promise<GoalCycle[]> {
  return rowsOf<GoalCycle>(
    await db.execute(sql`
      select distinct c.id, c.name, c.localized_name as "localizedName",
        c.period_end::text as "periodEnd"
      ${goalsFrom(today)}
      join participant_goal_snapshot s on s.goal_id = g.id and not s.no_longer_applicable
      join cycle_participant cp on cp.id = s.participant_id and cp.removed_at is null
      join review_cycle c on c.id = cp.cycle_id and c.deleted_at is null
        and c.status <> 'draft'
      where ${allOf([sql`g.deleted_at is null`, scopeCondition(individualScope(actor))])}
      order by "periodEnd" desc, c.name, c.id`),
  );
}

/** The values of the area and org selects: what the owners of the goals in scope carry. */
export async function goalFilterOptions(
  db: DbOrTx,
  actor: ActorContext,
  today: string = todayLocal(),
): Promise<GoalFilterOptions> {
  const rows = rowsOf<{
    department: string | null;
    account: string | null;
    project: string | null;
    dm: string | null;
    santex_lead: string | null;
  }>(
    await db.execute(sql`
      select distinct j.department, ${orgAttributeColumns}
      ${goalsFrom(today)}
      where ${allOf([sql`g.deleted_at is null`, scopeCondition(individualScope(actor))])}`),
  );
  const collator = new Intl.Collator("es");
  return {
    departments: [
      ...new Set(rows.flatMap((r) => (r.department ? [r.department] : []))),
    ].sort(collator.compare),
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

// ----------------------------------------------------------------- detail

export type GoalMilestoneItem = {
  id: string;
  title: string;
  position: number;
  completedAt: string | null;
};

export type GoalCommentItem = {
  id: string;
  /** Null when the author could not be matched to a person. */
  author: string | null;
  text: string;
  postedAt: string | null;
};

/** A cycle whose assessment lists the goal among the participant's goals of the period. */
export type GoalAppearance = {
  cycleId: string;
  cycleName: string;
  localizedName: LocalizedText | null;
  periodEnd: string;
  participantId: string;
  revieweePersonId: string;
  snapManagerPersonId: string | null;
};

export type GoalDetail = {
  id: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  state: GoalState;
  percentComplete: number;
  createdAt: string;
  dueDate: string | null;
  completionDate: string | null;
  lastChangedAt: string | null;
  person: { id: string; name: string };
  department: string | null;
  milestones: GoalMilestoneItem[];
  comments: GoalCommentItem[];
  appearances: GoalAppearance[];
};

/**
 * One goal with its milestones and comments; null if unknown (or deleted).
 * Throws `forbidden` when `actor` may not read that person's goals.
 */
export async function getGoalDetail(
  db: DbOrTx,
  actor: ActorContext,
  id: string,
  today: string = todayLocal(),
): Promise<GoalDetail | null> {
  const scope = individualScope(actor);
  if (scope.kind === "none") throw new ReviewError("forbidden");
  if (!isUuid(id)) return null;
  const [row] = rowsOf<{
    id: string;
    title: string;
    description: string | null;
    status: GoalStatus;
    percentComplete: number;
    createdAt: string;
    dueDate: string | null;
    completionDate: string | null;
    lastChangedAt: string | null;
    personId: string;
    personName: string;
    department: string | null;
    readable: boolean;
  }>(
    await db.execute(sql`
      select g.id, g.title, g.description, g.status::text as status,
        g.percent_complete as "percentComplete",
        ${iso("g.created_at")} as "createdAt",
        g.due_date::text as "dueDate", g.completion_date::text as "completionDate",
        ${iso("g.last_changed_at")} as "lastChangedAt",
        g.person_id as "personId", p.display_name as "personName", j.department,
        (${scopeCondition(scope)}) as readable
      ${goalsFrom(today)}
      where g.id = ${id}::uuid and g.deleted_at is null`),
  );
  if (!row) return null;
  if (!row.readable) throw new ReviewError("forbidden");

  const [milestones, comments, appearances] = await Promise.all([
    db.execute(sql`
      select m.id, m.title, m.position, ${iso("m.completed_at")} as "completedAt"
      from goal_milestone m
      where m.goal_id = ${id}::uuid and m.deleted_at is null
      order by m.position, m.id`),
    db.execute(sql`
      select c.id, ap.display_name as author, c.text,
        ${iso("coalesce(c.posted_at, c.created_at)")} as "postedAt"
      from goal_comment c
      left join person ap on ap.id = c.author_person_id
      where c.goal_id = ${id}::uuid and c.deleted_at is null
      order by coalesce(c.posted_at, c.created_at), c.id`),
    db.execute(sql`
      select rc.id as "cycleId", rc.name as "cycleName",
        rc.localized_name as "localizedName",
        rc.period_end::text as "periodEnd", cp.id as "participantId",
        cp.reviewee_person_id as "revieweePersonId",
        cp.snap_manager_person_id as "snapManagerPersonId"
      from participant_goal_snapshot s
      join cycle_participant cp on cp.id = s.participant_id and cp.removed_at is null
      join review_cycle rc on rc.id = cp.cycle_id and rc.deleted_at is null
        and rc.status <> 'draft'
      where s.goal_id = ${id}::uuid and not s.no_longer_applicable
      order by rc.period_end desc, rc.name`),
  ]);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    state: goalState(row, today),
    percentComplete: row.percentComplete,
    createdAt: row.createdAt,
    dueDate: row.dueDate,
    completionDate: row.completionDate,
    lastChangedAt: row.lastChangedAt,
    person: { id: row.personId, name: row.personName },
    department: row.department,
    milestones: rowsOf<GoalMilestoneItem>(milestones),
    comments: rowsOf<GoalCommentItem>(comments),
    appearances: rowsOf<GoalAppearance>(appearances),
  };
}

/**
 * Which of `goalIds` `actor` may open (for the links from an assessment's
 * goals block: a manager reads their reports' goals of today, which may not
 * be the ones the cycle snapshot had).
 */
export async function readableGoalIds(
  db: DbOrTx,
  actor: ActorContext,
  goalIds: string[],
  today: string = todayLocal(),
): Promise<Set<string>> {
  const scope = individualScope(actor);
  const valid = goalIds.filter(isUuid);
  if (scope.kind === "none" || valid.length === 0) return new Set();
  const rows = rowsOf<{ id: string }>(
    await db.execute(sql`
      select g.id
      ${goalsFrom(today)}
      where g.deleted_at is null and ${scopeCondition(scope)}
        and g.id in (${sql.join(
          valid.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`),
  );
  return new Set(rows.map((r) => r.id));
}
