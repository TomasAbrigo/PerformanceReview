import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  employment,
  person,
  reviewCycle,
  type ReviewCycle,
} from "@/db/schema";
import { parse } from "@/lib/domain-error";
import { parseIsoDate, todayLocal } from "@/modules/org-history/dates";
import { type IsoDate, jobsAsOf } from "@/modules/org-history/queries";
import { CyclesError } from "./errors";
import { snapshotGoalsForParticipants } from "./goal-snapshot";
import { assignCycleGroups } from "./groups";
import {
  addDays,
  enrollmentHireDateRange,
  hireDateTimeline,
  hireDueDates,
} from "./hire-date-schedule";
import { ensureSelfRequests } from "./requests";
import { findCycle, matchParticipants, snapshots } from "./service";
import type { CycleDueDates } from "./status";
import { hireDateScheduleInput, lookbackDaysInput } from "./validation";

/**
 * Hire-date cadence: a `hire_date` cycle brings people in as they reach the
 * milestone (hire date + N days) and gives each their own deadline
 * (milestone + window). Meant to run daily (`pnpm cycles:enroll`).
 */

/** Live employments that are their person's latest one (rehires: the newest). */
const isLatestEmployment = sql`not exists (
  select 1 from employment later
  where later.person_id = ${employment.personId}
    and later.deleted_at is null
    and later.hire_date > ${employment.hireDate})`;

export type EnrolledParticipant = {
  personId: string;
  displayName: string;
  hireDate: IsoDate;
  milestoneDate: IsoDate;
  /** Own deadlines of this person (self and manager share the window's end). */
  dueDates: CycleDueDates;
};

/** Someone due who could not be enrolled (and will be retried on later runs). */
export type SkippedPerson = {
  personId: string;
  displayName: string;
  hireDate: IsoDate;
  /** No job row on the enrollment date: the ingest has not brought it yet. */
  reason: "no_job_history";
};

export type EnrollResult = {
  cycleId: string;
  asOf: IsoDate;
  enrolled: EnrolledParticipant[];
  skipped: SkippedPerson[];
  /** Only set by `enrollAllDueParticipants` when this cycle failed. */
  error?: string;
};

export type EnrollOptions = {
  /** Extra days past the window to look back (catching up after an outage). */
  lookbackDays?: number;
};

/**
 * Adds to a launched hire-date cycle everyone whose hire date + milestone
 * falls in [asOf - window, asOf], who is still employed on `asOf` and is not
 * a participant yet (removed people stay out). Each gets an org snapshot as
 * of `asOf`, their template group, and their own due dates. Idempotent:
 * running it again the same day adds no one.
 *
 * Someone due who has no job row on `asOf` (the ingest has not brought their
 * history yet) cannot be snapshotted: they come back in `skipped` and are
 * retried by every run while their window lasts; `lookbackDays` extends the
 * range for the ones whose window already closed.
 */
export async function enrollDueParticipants(
  db: DbOrTx,
  cycleId: string,
  asOf: IsoDate = todayLocal(),
  opts: EnrollOptions = {},
): Promise<EnrollResult> {
  if (!parseIsoDate(asOf)) {
    throw new CyclesError("validation", [
      { path: "asOf", message: "invalid_date" },
    ]);
  }
  const cycle = await findCycle(db, cycleId);
  if (cycle.scheduleKind !== "hire_date" || !cycle.hireDateSchedule) {
    throw new CyclesError("not_hire_date");
  }
  if (cycle.status === "draft" || cycle.status === "closed") {
    throw new CyclesError("not_active");
  }
  const schedule = parse(
    hireDateScheduleInput,
    cycle.hireDateSchedule,
    CyclesError,
  );

  const lookback = parse(
    lookbackDaysInput,
    opts.lookbackDays ?? 0,
    CyclesError,
  );
  const range = enrollmentHireDateRange(asOf, schedule);
  const hires = await db
    .select({ personId: employment.personId, hireDate: employment.hireDate })
    .from(employment)
    .where(
      and(
        isNull(employment.deletedAt),
        isNotNull(employment.hireDate),
        gte(employment.hireDate, addDays(range.from, -lookback)),
        lte(employment.hireDate, range.to),
        // Still employed on the enrollment date (job rows may lag the ingest).
        or(
          isNull(employment.terminationDate),
          gt(employment.terminationDate, asOf),
        ),
        isLatestEmployment,
      ),
    );
  const hireDateOf = new Map(
    hires.map((h) => [h.personId, h.hireDate as IsoDate]),
  );
  if (hireDateOf.size === 0)
    return { cycleId, asOf, enrolled: [], skipped: [] };

  // Anyone who ever was a participant (removed ones too) is not enrolled again.
  const known = new Set(
    (
      await db
        .select({ personId: cycleParticipant.revieweePersonId })
        .from(cycleParticipant)
        .where(eq(cycleParticipant.cycleId, cycleId))
    ).map((r) => r.personId),
  );
  const candidates = (
    await matchParticipants(db, cycle.participantFilter, asOf)
  ).filter((p) => hireDateOf.has(p.personId) && !known.has(p.personId));
  const skipped = await withoutJobHistory(
    db,
    asOf,
    hireDateOf,
    known,
    new Set(candidates.map((p) => p.personId)),
  );
  if (candidates.length === 0) return { cycleId, asOf, enrolled: [], skipped };

  const personIds = candidates.map((p) => p.personId);
  const [snaps, groupOf] = await Promise.all([
    snapshots(db, cycleId, personIds, asOf),
    assignCycleGroups(db, cycleId, personIds, asOf),
  ]);
  const timeline = (personId: string) =>
    hireDateTimeline(hireDateOf.get(personId)!, schedule);
  const dueDatesOf = (personId: string) =>
    hireDueDates(hireDateOf.get(personId)!, schedule);
  const inserted = await db
    .insert(cycleParticipant)
    .values(
      snaps.map((s) => ({
        ...s,
        templateGroupId: groupOf.get(s.revieweePersonId) ?? null,
        dueDates: dueDatesOf(s.revieweePersonId),
      })),
    )
    // Two concurrent runs: the loser simply adds no one.
    .onConflictDoNothing()
    .returning({
      id: cycleParticipant.id,
      personId: cycleParticipant.revieweePersonId,
    });
  const added = new Set(inserted.map((r) => r.personId));
  // Like any participant: their goals as of today, then (in a collecting
  // cycle) their requests right away.
  await snapshotGoalsForParticipants(
    db,
    inserted.map((r) => r.id),
  );
  if (added.size > 0) await ensureSelfRequests(db, cycleId);

  return {
    cycleId,
    asOf,
    skipped,
    enrolled: candidates
      .filter((p) => added.has(p.personId))
      .map((p) => ({
        personId: p.personId,
        displayName: p.displayName,
        hireDate: hireDateOf.get(p.personId)!,
        milestoneDate: timeline(p.personId).milestoneDate,
        dueDates: dueDatesOf(p.personId),
      })),
  };
}

/** People due (and not participants yet) that no job row on `asOf` lets us enroll. */
async function withoutJobHistory(
  db: DbOrTx,
  asOf: IsoDate,
  hireDateOf: Map<string, IsoDate>,
  known: Set<string>,
  matched: Set<string>,
): Promise<SkippedPerson[]> {
  const unmatched = [...hireDateOf.keys()].filter(
    (id) => !known.has(id) && !matched.has(id),
  );
  if (unmatched.length === 0) return [];
  const jobs = await jobsAsOf(db, unmatched, asOf);
  const missing = unmatched.filter((id) => !jobs.has(id));
  if (missing.length === 0) return [];
  const names = await db
    .select({ id: person.id, displayName: person.displayName })
    .from(person)
    .where(inArray(person.id, missing))
    .orderBy(asc(person.displayName));
  return names.map((n) => ({
    personId: n.id,
    displayName: n.displayName,
    hireDate: hireDateOf.get(n.id)!,
    reason: "no_job_history" as const,
  }));
}

/**
 * Own deadlines of `personIds` in a hire-date cycle (hire date of their
 * latest employment + milestone + window); empty for fixed-date cycles.
 */
export async function hireDueDatesFor(
  db: DbOrTx,
  cycle: ReviewCycle,
  personIds: string[],
): Promise<Map<string, CycleDueDates>> {
  const dueDates = new Map<string, CycleDueDates>();
  if (
    cycle.scheduleKind !== "hire_date" ||
    !cycle.hireDateSchedule ||
    personIds.length === 0
  ) {
    return dueDates;
  }
  const schedule = parse(
    hireDateScheduleInput,
    cycle.hireDateSchedule,
    CyclesError,
  );
  const hires = await db
    .select({ personId: employment.personId, hireDate: employment.hireDate })
    .from(employment)
    .where(
      and(
        inArray(employment.personId, personIds),
        isNull(employment.deletedAt),
        isNotNull(employment.hireDate),
        isLatestEmployment,
      ),
    );
  for (const h of hires) {
    dueDates.set(h.personId, hireDueDates(h.hireDate as IsoDate, schedule));
  }
  return dueDates;
}

/**
 * Runs `enrollDueParticipants` on every launched, not closed hire-date cycle.
 * A cycle that fails is reported with its `error` and does not stop the rest.
 */
export async function enrollAllDueParticipants(
  db: DbOrTx,
  asOf: IsoDate = todayLocal(),
  opts: EnrollOptions = {},
): Promise<EnrollResult[]> {
  const cycles = await db
    .select({ id: reviewCycle.id })
    .from(reviewCycle)
    .where(
      and(
        eq(reviewCycle.scheduleKind, "hire_date"),
        isNull(reviewCycle.deletedAt),
        notInArray(reviewCycle.status, ["draft", "closed"]),
      ),
    )
    .orderBy(asc(reviewCycle.createdAt));
  const results: EnrollResult[] = [];
  for (const { id } of cycles) {
    try {
      results.push(await enrollDueParticipants(db, id, asOf, opts));
    } catch (error) {
      results.push({
        cycleId: id,
        asOf,
        enrolled: [],
        skipped: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export type RecentHire = {
  personId: string;
  displayName: string;
  hireDate: IsoDate;
};

/** The most recently hired people still employed (sample for the wizard preview). */
export async function recentHires(
  db: DbOrTx,
  limit = 5,
): Promise<RecentHire[]> {
  const rows = await db
    .select({
      personId: person.id,
      displayName: person.displayName,
      hireDate: employment.hireDate,
    })
    .from(employment)
    .innerJoin(person, eq(person.id, employment.personId))
    .where(
      and(
        isNull(employment.deletedAt),
        isNull(employment.terminationDate),
        isNotNull(employment.hireDate),
        isLatestEmployment,
      ),
    )
    .orderBy(desc(employment.hireDate), asc(person.displayName))
    .limit(limit);
  return rows.map((r) => ({ ...r, hireDate: r.hireDate as IsoDate }));
}
