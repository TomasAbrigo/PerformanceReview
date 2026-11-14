import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { cycleParticipant, employment, person, reviewCycle } from "@/db/schema";
import { parse } from "@/lib/domain-error";
import { parseIsoDate, todayLocal } from "@/modules/org-history/dates";
import type { IsoDate } from "@/modules/org-history/queries";
import { CyclesError } from "./errors";
import { assignCycleGroups } from "./groups";
import {
  enrollmentHireDateRange,
  hireDateTimeline,
} from "./hire-date-schedule";
import { ensureSelfRequests } from "./requests";
import { findCycle, matchParticipants, snapshots } from "./service";
import type { CycleDueDates } from "./status";
import { hireDateScheduleInput } from "./validation";

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

export type EnrollResult = {
  cycleId: string;
  asOf: IsoDate;
  enrolled: EnrolledParticipant[];
  /** Only set by `enrollAllDueParticipants` when this cycle failed. */
  error?: string;
};

/**
 * Adds to a launched hire-date cycle everyone whose hire date + milestone
 * falls in [asOf - window, asOf] and is not a participant yet (removed
 * people stay out). Each gets an org snapshot as of `asOf`, their template
 * group, and their own due dates. Idempotent: running it again the same day
 * adds no one.
 */
export async function enrollDueParticipants(
  db: DbOrTx,
  cycleId: string,
  asOf: IsoDate = todayLocal(),
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

  const range = enrollmentHireDateRange(asOf, schedule);
  const hires = await db
    .select({ personId: employment.personId, hireDate: employment.hireDate })
    .from(employment)
    .where(
      and(
        isNull(employment.deletedAt),
        isNotNull(employment.hireDate),
        gte(employment.hireDate, range.from),
        lte(employment.hireDate, range.to),
        isLatestEmployment,
      ),
    );
  const hireDateOf = new Map(
    hires.map((h) => [h.personId, h.hireDate as IsoDate]),
  );
  if (hireDateOf.size === 0) return { cycleId, asOf, enrolled: [] };

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
  if (candidates.length === 0) return { cycleId, asOf, enrolled: [] };

  const personIds = candidates.map((p) => p.personId);
  const [snaps, groupOf] = await Promise.all([
    snapshots(db, cycleId, personIds, asOf),
    assignCycleGroups(db, cycleId, personIds, asOf),
  ]);
  const timeline = (personId: string) =>
    hireDateTimeline(hireDateOf.get(personId)!, schedule);
  const inserted = await db
    .insert(cycleParticipant)
    .values(
      snaps.map((s) => ({
        ...s,
        templateGroupId: groupOf.get(s.revieweePersonId) ?? null,
        dueDates: dueDatesOf(timeline(s.revieweePersonId).dueDate),
      })),
    )
    // Two concurrent runs: the loser simply adds no one.
    .onConflictDoNothing()
    .returning({ personId: cycleParticipant.revieweePersonId });
  const added = new Set(inserted.map((r) => r.personId));
  // Collecting cycles get the newcomers' self requests right away.
  if (added.size > 0) await ensureSelfRequests(db, cycleId);

  return {
    cycleId,
    asOf,
    enrolled: candidates
      .filter((p) => added.has(p.personId))
      .map((p) => ({
        personId: p.personId,
        displayName: p.displayName,
        hireDate: hireDateOf.get(p.personId)!,
        milestoneDate: timeline(p.personId).milestoneDate,
        dueDates: dueDatesOf(timeline(p.personId).dueDate),
      })),
  };
}

const dueDatesOf = (dueDate: IsoDate): CycleDueDates => ({
  self: dueDate,
  manager: dueDate,
});

/**
 * Runs `enrollDueParticipants` on every launched, not closed hire-date cycle.
 * A cycle that fails is reported with its `error` and does not stop the rest.
 */
export async function enrollAllDueParticipants(
  db: DbOrTx,
  asOf: IsoDate = todayLocal(),
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
      results.push(await enrollDueParticipants(db, id, asOf));
    } catch (error) {
      results.push({
        cycleId: id,
        asOf,
        enrolled: [],
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
