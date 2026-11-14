import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  ingestRun,
  type IdentityIssueReason,
  type SourceSystem,
} from "@/db/schema";
import { jobValidOn, rowsOf } from "@/lib/sql";
import { listIssues } from "@/modules/identity";
import { normalizeName } from "@/modules/identity/normalize";
import { activeEmploymentCte } from "@/modules/people/employment";

/**
 * Data-quality indicators (PRD module 8, stories 19 and 74). Each indicator
 * is ONE named query returning every offending row; the count is the number
 * of those rows, so the panel's number and its detail list cannot disagree.
 * "Today" and "active" follow the rest of the app: `current_date` and
 * `activeEmploymentCte` (people/employment.ts).
 */
export type Indicator<K extends string, I> = {
  key: K;
  count: number;
  items: I[];
};

const indicator = <K extends string, I>(
  key: K,
  items: I[],
): Indicator<K, I> => ({
  key,
  count: items.length,
  items,
});

/** Display order of the panel. */
export const DATA_QUALITY_KEYS = [
  "identity_open",
  "no_manager",
  "participants_no_manager",
  "participants_incomplete_snapshot",
  "job_history_overlap_gap",
  "job_history_open_after_exit",
  "active_without_job_history",
  "goals_without_employment",
  "duplicate_names",
  "failed_runs",
  "reviewer_mismatch",
] as const;
export type DataQualityKey = (typeof DATA_QUALITY_KEYS)[number];

export const isDataQualityKey = (key: string): key is DataQualityKey =>
  (DATA_QUALITY_KEYS as readonly string[]).includes(key);

/** How far back "recent" failed ingest runs go. */
export const FAILED_RUN_DAYS = 7;

// ---------------------------------------------------------------- identity

export type IdentityOpenItem = {
  /** identity_match_issue id. */
  id: string;
  reason: IdentityIssueReason;
  sourceSystem: SourceSystem;
  entity: string;
  sourceId: string;
  displayName: string | null;
  createdAt: Date;
};

/** Identity-queue cases still open: the same set `/imports/identity` lists. */
export async function openIdentityIssues(
  db: DbOrTx,
): Promise<Indicator<"identity_open", IdentityOpenItem>> {
  const { items } = await listIssues(db, { status: "open" });
  return indicator(
    "identity_open",
    items.map((i) => ({
      id: i.id,
      reason: i.reason,
      sourceSystem: i.sourceSystem,
      entity: i.entity,
      sourceId: i.sourceId,
      displayName: i.summary.displayName,
      createdAt: i.createdAt,
    })),
  );
}

// ------------------------------------------------------------- org / people

export type NoManagerItem = {
  /** person id. */
  id: string;
  displayName: string;
  workEmail: string | null;
  /** reportsTo as Bamboo had it, when it could not be resolved to a person. */
  managerRaw: string | null;
  /** Has direct reports today: the top of the org (the CEO), expected. */
  isTop: boolean;
};

/**
 * Active people whose current job row has no manager. The top of the org
 * (somebody others report to) is included and flagged `isTop`.
 */
export async function peopleWithoutManager(
  db: DbOrTx,
): Promise<Indicator<"no_manager", NoManagerItem>> {
  const rows = rowsOf<NoManagerItem>(
    await db.execute(sql`
      with ${activeEmploymentCte}
      select p.id, p.display_name as "displayName", p.work_email as "workEmail",
        j.manager_raw as "managerRaw",
        exists (
          select 1 from employee_job_history r
          where r.manager_person_id = p.id and ${jobValidOn("r")}
        ) as "isTop"
      from active_employment a
      join person p on p.id = a.person_id
      join lateral (
        select h.manager_person_id, h.manager_raw
        from employee_job_history h
        where h.person_id = p.id and ${jobValidOn("h")}
        order by h.valid_from desc, h.id
        limit 1
      ) j on true
      where j.manager_person_id is null
      order by p.display_name, p.id
    `),
  );
  return indicator("no_manager", rows);
}

export type ActiveWithoutJobItem = {
  /** person id. */
  id: string;
  displayName: string;
  workEmail: string | null;
};

/** Active people with no (non-deleted) job history row at all. */
export async function activeWithoutJobHistory(
  db: DbOrTx,
): Promise<Indicator<"active_without_job_history", ActiveWithoutJobItem>> {
  const rows = rowsOf<ActiveWithoutJobItem>(
    await db.execute(sql`
      with ${activeEmploymentCte}
      select p.id, p.display_name as "displayName", p.work_email as "workEmail"
      from active_employment a
      join person p on p.id = a.person_id
      where not exists (
        select 1 from employee_job_history h
        where h.person_id = p.id and h.deleted_at is null
      )
      order by p.display_name, p.id
    `),
  );
  return indicator("active_without_job_history", rows);
}

export type JobHistoryAnomalyItem = {
  /** The later job row of the pair. */
  id: string;
  personId: string;
  displayName: string;
  kind: "overlap" | "gap";
  /** ISO dates: the days covered twice (overlap) or by no row (gap). */
  from: string;
  /** null: an overlap that runs on with no end. */
  to: string | null;
};

/**
 * SCD2 sanity: job rows of a person that overlap an earlier row, or leave a
 * gap after everything before them. A gap between two employments (a rehire)
 * is expected and not reported.
 */
export async function jobHistoryGapsAndOverlaps(
  db: DbOrTx,
): Promise<Indicator<"job_history_overlap_gap", JobHistoryAnomalyItem>> {
  const rows = rowsOf<JobHistoryAnomalyItem>(
    await db.execute(sql`
      with ordered as (
        select h.id, h.person_id, h.valid_from, h.valid_to, h.employment_id,
          max(coalesce(h.valid_to, 'infinity'::date)) over (
            partition by h.person_id order by h.valid_from
            rows between unbounded preceding and 1 preceding
          ) as prev_max_to,
          lag(h.employment_id) over (
            partition by h.person_id order by h.valid_from
          ) as prev_employment_id
        from employee_job_history h
        where h.deleted_at is null
      )
      select o.id, o.person_id as "personId", p.display_name as "displayName",
        case when o.valid_from < o.prev_max_to then 'overlap' else 'gap' end as kind,
        (case when o.valid_from < o.prev_max_to
          then o.valid_from else o.prev_max_to end)::text as "from",
        nullif((case when o.valid_from < o.prev_max_to
          then least(o.prev_max_to, coalesce(o.valid_to, 'infinity'::date))
          else o.valid_from end)::text, 'infinity') as "to"
      from ordered o
      join person p on p.id = o.person_id
      where o.prev_max_to is not null
        and (
          o.valid_from < o.prev_max_to
          or (o.valid_from > o.prev_max_to
              and o.prev_employment_id is not distinct from o.employment_id)
        )
      order by p.display_name, p.id, o.valid_from
    `),
  );
  return indicator("job_history_overlap_gap", rows);
}

export type OpenAfterExitItem = {
  /** The job row left open. */
  id: string;
  personId: string;
  displayName: string;
  validFrom: string;
  /** Termination date of the latest employment, when it has one. */
  terminationDate: string | null;
};

/** People who are no longer active but still have an open (valid_to null) job row. */
export async function jobHistoryOpenAfterExit(
  db: DbOrTx,
): Promise<Indicator<"job_history_open_after_exit", OpenAfterExitItem>> {
  const rows = rowsOf<OpenAfterExitItem>(
    await db.execute(sql`
      with ${activeEmploymentCte}
      select h.id, h.person_id as "personId", p.display_name as "displayName",
        h.valid_from::text as "validFrom",
        (select e.termination_date::text from employment e
          where e.person_id = p.id and e.deleted_at is null
          order by e.hire_date desc nulls last, e.id limit 1) as "terminationDate"
      from employee_job_history h
      join person p on p.id = h.person_id
      where h.deleted_at is null and h.valid_to is null
        and exists (
          select 1 from employment e
          where e.person_id = p.id and e.deleted_at is null
        )
        and not exists (
          select 1 from active_employment a where a.person_id = p.id
        )
      order by p.display_name, p.id, h.valid_from
    `),
  );
  return indicator("job_history_open_after_exit", rows);
}

export type DuplicateNameItem = {
  /** person id. */
  id: string;
  displayName: string;
  workEmail: string | null;
  /** How many active people share this name (this one included). */
  duplicates: number;
};

/**
 * Active people who share a display name with another active person (same
 * name ignoring case, accents, punctuation and word order): the identity
 * resolver cannot tell them apart by name.
 */
export async function duplicateDisplayNames(
  db: DbOrTx,
): Promise<Indicator<"duplicate_names", DuplicateNameItem>> {
  const people = rowsOf<{
    id: string;
    displayName: string;
    workEmail: string | null;
  }>(
    await db.execute(sql`
      with ${activeEmploymentCte}
      select p.id, p.display_name as "displayName", p.work_email as "workEmail"
      from active_employment a
      join person p on p.id = a.person_id
      order by p.display_name, p.id
    `),
  );
  const groups = new Map<string, typeof people>();
  for (const p of people) {
    const key = normalizeName(p.displayName);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const items = [...groups.values()]
    .filter((g) => g.length > 1)
    .flatMap((g) => g.map((p) => ({ ...p, duplicates: g.length })))
    .sort(
      (a, b) =>
        a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id),
    );
  return indicator("duplicate_names", items);
}

export type GoalWithoutEmploymentItem = {
  /** goal id. */
  id: string;
  personId: string;
  displayName: string;
  title: string;
};

/** Goals (not deleted) whose owner has no live (not soft-deleted) employment. */
export async function goalsWithoutLiveEmployment(
  db: DbOrTx,
): Promise<Indicator<"goals_without_employment", GoalWithoutEmploymentItem>> {
  const rows = rowsOf<GoalWithoutEmploymentItem>(
    await db.execute(sql`
      select g.id, g.person_id as "personId", p.display_name as "displayName",
        g.title
      from goal g
      join person p on p.id = g.person_id
      where g.deleted_at is null
        and not exists (
          select 1 from employment e
          where e.person_id = g.person_id and e.deleted_at is null
        )
      order by p.display_name, g.title, g.id
    `),
  );
  return indicator("goals_without_employment", rows);
}

// ----------------------------------------------------------------- cycles

export type ParticipantItem = {
  /** cycle_participant id. */
  id: string;
  cycleId: string;
  cycleName: string;
  /** The reviewee. */
  personId: string;
  displayName: string;
};

export type IncompleteSnapshotItem = ParticipantItem & {
  missing: ("department" | "job_title")[];
};

/** Participants (not removed, cycle not deleted) with no manager in the snapshot. */
export async function participantsWithoutSnapshotManager(
  db: DbOrTx,
): Promise<Indicator<"participants_no_manager", ParticipantItem>> {
  const rows = rowsOf<ParticipantItem>(
    await db.execute(sql`
      select cp.id, cp.cycle_id as "cycleId", c.name as "cycleName",
        cp.reviewee_person_id as "personId", p.display_name as "displayName"
      from cycle_participant cp
      join review_cycle c on c.id = cp.cycle_id and c.deleted_at is null
      join person p on p.id = cp.reviewee_person_id
      where cp.removed_at is null and cp.snap_manager_person_id is null
      order by c.name, c.id, p.display_name, cp.id
    `),
  );
  return indicator("participants_no_manager", rows);
}

/** Participants whose snapshot is missing the area (department) or the job title. */
export async function participantsWithIncompleteSnapshot(
  db: DbOrTx,
): Promise<
  Indicator<"participants_incomplete_snapshot", IncompleteSnapshotItem>
> {
  const rows = rowsOf<
    ParticipantItem & { noDepartment: boolean; noJobTitle: boolean }
  >(
    await db.execute(sql`
      select cp.id, cp.cycle_id as "cycleId", c.name as "cycleName",
        cp.reviewee_person_id as "personId", p.display_name as "displayName",
        cp.snap_department is null as "noDepartment",
        cp.snap_job_title is null as "noJobTitle"
      from cycle_participant cp
      join review_cycle c on c.id = cp.cycle_id and c.deleted_at is null
      join person p on p.id = cp.reviewee_person_id
      where cp.removed_at is null
        and (cp.snap_department is null or cp.snap_job_title is null)
      order by c.name, c.id, p.display_name, cp.id
    `),
  );
  return indicator(
    "participants_incomplete_snapshot",
    rows.map(({ noDepartment, noJobTitle, ...item }) => ({
      ...item,
      missing: [
        ...(noDepartment ? (["department"] as const) : []),
        ...(noJobTitle ? (["job_title"] as const) : []),
      ],
    })),
  );
}

// ----------------------------------------------------------------- ingest

export type FailedRunItem = {
  /** ingest_run id. */
  id: string;
  entity: string;
  sourceSystem: string | null;
  startedAt: Date;
  error: string | null;
};

/** Ingest runs that ended in error in the last 7 days (as of `now`). */
export async function failedIngestRuns(
  db: DbOrTx,
  { now = new Date() }: { now?: Date } = {},
): Promise<Indicator<"failed_runs", FailedRunItem>> {
  const since = new Date(now.getTime() - FAILED_RUN_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: ingestRun.id,
      entity: ingestRun.entity,
      sourceSystem: ingestRun.sourceSystem,
      startedAt: ingestRun.startedAt,
      error: ingestRun.error,
    })
    .from(ingestRun)
    .where(and(eq(ingestRun.status, "error"), gte(ingestRun.startedAt, since)))
    .orderBy(sql`${ingestRun.startedAt} desc`, asc(ingestRun.id));
  return indicator("failed_runs", rows);
}

// --------------------------------------------------------------- requests

export type ReviewerMismatchItem = {
  /** review request id. */
  id: string;
  cycleId: string;
  cycleName: string;
  personId: string;
  displayName: string;
};

/**
 * TODO(#35): the review_request table (and its reviewer_mismatch flag) is not
 * on main yet. Flip this when it lands; `reviewerMismatch` then returns the
 * requests whose reviewer is not the manager of the snapshot.
 */
export const hasReviewRequests = (): boolean => false;

/** Requests whose reviewer does not match the snapshot manager; null until review requests exist. */
export async function reviewerMismatch(
  db: DbOrTx,
): Promise<Indicator<"reviewer_mismatch", ReviewerMismatchItem> | null> {
  void db;
  if (!hasReviewRequests()) return null;
  // TODO(#35): select the review_request rows flagged reviewer_mismatch.
  return null;
}

// ----------------------------------------------------------------- report

export type DataQualityIndicator =
  | Indicator<"identity_open", IdentityOpenItem>
  | Indicator<"no_manager", NoManagerItem>
  | Indicator<"participants_no_manager", ParticipantItem>
  | Indicator<"participants_incomplete_snapshot", IncompleteSnapshotItem>
  | Indicator<"job_history_overlap_gap", JobHistoryAnomalyItem>
  | Indicator<"job_history_open_after_exit", OpenAfterExitItem>
  | Indicator<"active_without_job_history", ActiveWithoutJobItem>
  | Indicator<"goals_without_employment", GoalWithoutEmploymentItem>
  | Indicator<"duplicate_names", DuplicateNameItem>
  | Indicator<"failed_runs", FailedRunItem>
  | Indicator<"reviewer_mismatch", ReviewerMismatchItem>;

type Options = { now?: Date };

const QUERIES: Record<
  DataQualityKey,
  (db: DbOrTx, options: Options) => Promise<DataQualityIndicator | null>
> = {
  identity_open: (db) => openIdentityIssues(db),
  no_manager: (db) => peopleWithoutManager(db),
  participants_no_manager: (db) => participantsWithoutSnapshotManager(db),
  participants_incomplete_snapshot: (db) =>
    participantsWithIncompleteSnapshot(db),
  job_history_overlap_gap: (db) => jobHistoryGapsAndOverlaps(db),
  job_history_open_after_exit: (db) => jobHistoryOpenAfterExit(db),
  active_without_job_history: (db) => activeWithoutJobHistory(db),
  goals_without_employment: (db) => goalsWithoutLiveEmployment(db),
  duplicate_names: (db) => duplicateDisplayNames(db),
  failed_runs: (db, options) => failedIngestRuns(db, options),
  reviewer_mismatch: (db) => reviewerMismatch(db),
};

/** Every available indicator, in panel order (the ones not built yet are left out). */
export async function getDataQuality(
  db: DbOrTx,
  options: Options = {},
): Promise<DataQualityIndicator[]> {
  const results = await Promise.all(
    DATA_QUALITY_KEYS.map((key) => QUERIES[key](db, options)),
  );
  return results.filter((r): r is DataQualityIndicator => r !== null);
}

/** One indicator with its items; null for an unknown key or one not available yet. */
export async function getIndicator(
  db: DbOrTx,
  key: string,
  options: Options = {},
): Promise<DataQualityIndicator | null> {
  return isDataQualityKey(key) ? QUERIES[key](db, options) : null;
}
