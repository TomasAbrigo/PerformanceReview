import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { ZodType } from "zod";
import { parse as parseOr } from "@/lib/domain-error";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  type CycleParticipant,
  cycleTransition,
  employeeJobHistory,
  employment,
  person,
  question,
  questionRevision,
  ratingScaleOption,
  reviewCycle,
  type ReviewCycle,
  templateSection,
  type ParticipantFilter,
} from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import { todayLocal } from "@/modules/org-history/dates";
import {
  jobsAsOf,
  jobValidOn,
  type IsoDate,
} from "@/modules/org-history/queries";
import { CyclesError } from "./errors";
import {
  snapshotGoalsForParticipant,
  snapshotGoalsForParticipants,
} from "./goal-snapshot";
import { ensureSelfRequests } from "./requests";
import { allowedTransitions, type CycleStatus, launchStatus } from "./status";
import {
  cycleInput,
  type CycleInput,
  cycleUpdateInput,
  type CycleUpdateInput,
  participantFilterInput,
  type ParticipantFilterInput,
} from "./validation";

const parse = <T>(schema: ZodType<T>, input: unknown): T =>
  parseOr(schema, input, CyclesError);

async function findCycle(db: DbOrTx, id: string): Promise<ReviewCycle> {
  const [cycle] = isUuid(id)
    ? await db.select().from(reviewCycle).where(eq(reviewCycle.id, id))
    : [];
  if (!cycle || cycle.deletedAt) throw new CyclesError("not_found");
  return cycle;
}

// ------------------------------------------------------------ create/edit

export async function createCycle(
  db: DbOrTx,
  input: CycleInput,
): Promise<ReviewCycle> {
  const data = parse(cycleInput, input);
  const [cycle] = await db.insert(reviewCycle).values(data).returning();
  return cycle;
}

/** Edits a draft freely; once launched only the name and due dates change. */
export async function updateCycle(
  db: DbOrTx,
  id: string,
  input: CycleUpdateInput,
): Promise<ReviewCycle> {
  const cycle = await findCycle(db, id);
  // Only the keys the caller sent (parsing would fill defaults in).
  const data = Object.fromEntries(
    Object.entries(parse(cycleUpdateInput, input)).filter(([k]) => k in input),
  );
  if (cycle.status !== "draft") {
    const locked = Object.keys(data).filter(
      (k) => k !== "name" && k !== "dueDates",
    );
    if (locked.length) throw new CyclesError("not_draft");
  }
  // Re-validate the merged cycle (date order across old and new fields).
  const merged = parse(cycleInput, {
    ...cycle,
    ...data,
  });
  const [updated] = await db
    .update(reviewCycle)
    .set(
      cycle.status === "draft"
        ? merged
        : { name: merged.name, dueDates: merged.dueDates },
    )
    .where(eq(reviewCycle.id, id))
    .returning();
  return updated;
}

// ------------------------------------------------------------ participants

export type ParticipantCandidate = {
  personId: string;
  displayName: string;
  department: string | null;
  jobTitle: string | null;
};

/** Status of the person's most recent live employment. */
const latestStatus = () =>
  sql`(select e.status from ${employment} e
    where e.person_id = ${person.id} and e.deleted_at is null
    order by e.hire_date desc nulls last limit 1)`;

/**
 * People matching a participant filter as of `asOf` (the cycle's snapshot
 * date): "all" and "filter" take whoever had a job row valid that day and
 * match area/division/location/title on that row, so the matched set and the
 * frozen snapshot agree. Status matches the latest live employment.
 * Individually picked people are taken as-is.
 */
async function matchParticipants(
  db: DbOrTx,
  filterInput: ParticipantFilterInput,
  asOf: IsoDate,
): Promise<ParticipantCandidate[]> {
  const filter = parse(participantFilterInput, filterInput);
  const where: (SQL | undefined)[] = [
    sql`exists (select 1 from ${employment} e
      where e.person_id = ${person.id} and e.deleted_at is null)`,
  ];
  if (filter.kind === "people") {
    where.push(inArray(person.id, filter.personIds));
  } else {
    const statuses = filter.kind === "filter" ? filter.statuses : undefined;
    where.push(
      isNotNull(employeeJobHistory.id),
      statuses?.length ? inArray(latestStatus(), statuses) : undefined,
    );
    if (filter.kind === "filter") {
      const by = (column: AnyPgColumn, v?: string[]) =>
        v?.length ? inArray(column, v) : undefined;
      where.push(
        by(employeeJobHistory.department, filter.departments),
        by(employeeJobHistory.division, filter.divisions),
        by(employeeJobHistory.location, filter.locations),
        by(employeeJobHistory.jobTitle, filter.jobTitles),
      );
    }
  }
  return db
    .select({
      personId: person.id,
      displayName: person.displayName,
      department: employeeJobHistory.department,
      jobTitle: employeeJobHistory.jobTitle,
    })
    .from(person)
    .leftJoin(
      employeeJobHistory,
      and(eq(employeeJobHistory.personId, person.id), jobValidOn(asOf)),
    )
    .where(and(...where))
    .orderBy(asc(person.displayName));
}

export type ParticipantPreview = {
  count: number;
  sample: ParticipantCandidate[];
};

/** Who a filter selects as of `asOf` (pass the cycle's snapshot date). */
export async function previewParticipants(
  db: DbOrTx,
  filter: ParticipantFilterInput,
  sampleSize = 10,
  asOf: IsoDate = todayLocal(),
): Promise<ParticipantPreview> {
  const people = await matchParticipants(db, filter, asOf);
  return { count: people.length, sample: people.slice(0, sampleSize) };
}

/** Distinct values offered by the wizard's filter step. */
export async function participantFilterOptions(db: DbOrTx): Promise<{
  departments: string[];
  divisions: string[];
  locations: string[];
  jobTitles: string[];
  statuses: string[];
  people: { id: string; displayName: string }[];
}> {
  const distinct = async (
    column:
      | typeof employeeJobHistory.department
      | typeof employeeJobHistory.division
      | typeof employeeJobHistory.location
      | typeof employeeJobHistory.jobTitle,
  ) =>
    (
      await db
        .selectDistinct({ v: column })
        .from(employeeJobHistory)
        .where(
          and(
            isNull(employeeJobHistory.validTo),
            isNull(employeeJobHistory.deletedAt),
          ),
        )
        .orderBy(asc(column))
    )
      .map((r) => r.v)
      .filter((v): v is string => !!v);
  const [departments, divisions, locations, jobTitles, statusRows, people] =
    await Promise.all([
      distinct(employeeJobHistory.department),
      distinct(employeeJobHistory.division),
      distinct(employeeJobHistory.location),
      distinct(employeeJobHistory.jobTitle),
      db
        .selectDistinct({ v: employment.status })
        .from(employment)
        .where(isNull(employment.deletedAt))
        .orderBy(asc(employment.status)),
      matchParticipants(db, { kind: "all" }, todayLocal()),
    ]);
  return {
    departments,
    divisions,
    locations,
    jobTitles,
    statuses: statusRows.map((r) => r.v).filter((v): v is string => !!v),
    people: people.map((p) => ({ id: p.personId, displayName: p.displayName })),
  };
}

/**
 * Org snapshots of reviewees as of `date`, via one org-history jobsAsOf query.
 * Also used by the historical import (src/modules/import-history).
 */
export async function snapshots(
  db: DbOrTx,
  cycleId: string,
  personIds: string[],
  date: IsoDate,
) {
  const jobs = await jobsAsOf(db, personIds, date);
  return personIds.map((personId) => {
    const job = jobs.get(personId);
    return {
      cycleId,
      revieweePersonId: personId,
      snapshotAsOf: date,
      snapManagerPersonId: job?.managerPersonId ?? null,
      snapDepartment: job?.department ?? null,
      snapDivision: job?.division ?? null,
      snapJobTitle: job?.jobTitle ?? null,
      snapLocation: job?.location ?? null,
      snapJobHistoryId: job?.id ?? null,
    };
  });
}

/** Copies the template's questions (and their scales) as immutable revisions. */
async function copyQuestions(db: DbOrTx, cycleId: string, templateId: string) {
  const rows = await db
    .select({ section: templateSection, question })
    .from(question)
    .innerJoin(templateSection, eq(templateSection.id, question.sectionId))
    .where(eq(templateSection.templateId, templateId))
    .orderBy(asc(templateSection.sort), asc(question.sort));
  if (rows.length === 0) return;
  const scaleIds = [
    ...new Set(rows.map((r) => r.question.scaleId).filter((v) => v !== null)),
  ];
  const options = scaleIds.length
    ? await db
        .select()
        .from(ratingScaleOption)
        .where(inArray(ratingScaleOption.scaleId, scaleIds))
        .orderBy(asc(ratingScaleOption.sort))
    : [];
  await db.insert(questionRevision).values(
    rows.map(({ section, question: q }, i) => ({
      cycleId,
      questionId: q.id,
      sectionTitle: section.title,
      prompt: q.prompt,
      kind: q.kind,
      appliesTo: q.appliesTo,
      visibleToReviewee: q.visibleToReviewee,
      required: q.required,
      choices: q.choices,
      role: q.role,
      scale: q.scaleId
        ? {
            options: options
              .filter((o) => o.scaleId === q.scaleId)
              .map((o) => ({
                value: o.value,
                label: o.label,
                normalized: o.normalized,
              })),
          }
        : null,
      sort: i,
    })),
  );
}

/**
 * Launches a draft: freezes the participants (with their org snapshot as of
 * snapshot_date), copies the template questions, and moves the cycle to its
 * first phase (nominations, or collecting when peers are off).
 */
export async function launchCycle(
  db: DbOrTx,
  id: string,
  actorPersonId: string | null,
): Promise<ReviewCycle> {
  return db.transaction(async (tx) => {
    const cycle = await findCycle(tx, id);
    if (cycle.status !== "draft") throw new CyclesError("not_draft");
    if (!cycle.templateId) throw new CyclesError("no_template");
    const people = await matchParticipants(
      tx,
      cycle.participantFilter,
      cycle.snapshotDate,
    );
    if (people.length === 0) throw new CyclesError("no_participants");

    const participants = await tx
      .insert(cycleParticipant)
      .values(
        await snapshots(
          tx,
          id,
          people.map((p) => p.personId),
          cycle.snapshotDate,
        ),
      )
      .returning({ id: cycleParticipant.id });
    await snapshotGoalsForParticipants(
      tx,
      participants.map((p) => p.id),
    );
    await copyQuestions(tx, id, cycle.templateId);

    const to = launchStatus(cycle.components);
    const [updated] = await tx
      .update(reviewCycle)
      .set({ status: to, launchedAt: new Date() })
      .where(eq(reviewCycle.id, id))
      .returning();
    await tx.insert(cycleTransition).values({
      cycleId: id,
      fromStatus: "draft",
      toStatus: to,
      actorPersonId,
    });
    await ensureSelfRequests(tx, id);
    return updated;
  });
}

// ------------------------------------------------------------ transitions

export async function transition(
  db: DbOrTx,
  id: string,
  to: CycleStatus,
  actorPersonId: string | null,
  note?: string | null,
): Promise<ReviewCycle> {
  return db.transaction(async (tx) => {
    const cycle = await findCycle(tx, id);
    if (!allowedTransitions(cycle.components, cycle.status).includes(to)) {
      throw new CyclesError("invalid_transition");
    }
    const [updated] = await tx
      .update(reviewCycle)
      .set({ status: to })
      .where(and(eq(reviewCycle.id, id), eq(reviewCycle.status, cycle.status)))
      .returning();
    if (!updated) throw new CyclesError("invalid_transition");
    await tx.insert(cycleTransition).values({
      cycleId: id,
      fromStatus: cycle.status,
      toStatus: to,
      actorPersonId,
      note: note || null,
    });
    await ensureSelfRequests(tx, id);
    return updated;
  });
}

// ------------------------------------------------- mid-cycle participants

async function activeCycle(db: DbOrTx, id: string): Promise<ReviewCycle> {
  const cycle = await findCycle(db, id);
  if (cycle.status === "draft" || cycle.status === "closed") {
    throw new CyclesError("not_active");
  }
  return cycle;
}

/** Adds a reviewee to a launched cycle, snapshotting their org data on `asOf`. */
export async function addParticipant(
  db: DbOrTx,
  cycleId: string,
  personId: string,
  asOf: IsoDate = todayLocal(),
): Promise<CycleParticipant> {
  // Participant and its self request are created together (or not at all).
  return db.transaction(async (tx) => {
    await activeCycle(tx, cycleId);
    const [existing] = await tx
      .select()
      .from(cycleParticipant)
      .where(
        and(
          eq(cycleParticipant.cycleId, cycleId),
          eq(cycleParticipant.revieweePersonId, personId),
        ),
      );
    if (existing && !existing.removedAt) {
      throw new CyclesError("already_participant");
    }
    const [values] = await snapshots(tx, cycleId, [personId], asOf);
    const [row] = existing
      ? await tx
          .update(cycleParticipant)
          .set({ ...values, addedAt: new Date(), removedAt: null })
          .where(eq(cycleParticipant.id, existing.id))
          .returning()
      : await tx.insert(cycleParticipant).values(values).returning();
    await snapshotGoalsForParticipant(tx, row.id);
    await ensureSelfRequests(tx, cycleId, row.id);
    return row;
  });
}

/** Removes a reviewee from a launched cycle; the row (and its history) stays. */
export async function removeParticipant(
  db: DbOrTx,
  cycleId: string,
  personId: string,
): Promise<void> {
  await activeCycle(db, cycleId);
  const updated = await db
    .update(cycleParticipant)
    .set({ removedAt: new Date() })
    .where(
      and(
        eq(cycleParticipant.cycleId, cycleId),
        eq(cycleParticipant.revieweePersonId, personId),
        isNull(cycleParticipant.removedAt),
      ),
    )
    .returning({ id: cycleParticipant.id });
  if (updated.length === 0) throw new CyclesError("not_found");
}

// ----------------------------------------------------------------- reads

export type CycleListItem = ReviewCycle & { participantCount: number };

export async function listCycles(db: DbOrTx): Promise<CycleListItem[]> {
  return db
    .select({
      ...getTableColumns(reviewCycle),
      participantCount: sql<number>`(select count(*)::int from ${cycleParticipant} cp
        where cp.cycle_id = "review_cycle"."id" and cp.removed_at is null)`,
    })
    .from(reviewCycle)
    .where(isNull(reviewCycle.deletedAt))
    .orderBy(desc(reviewCycle.createdAt));
}

export type CycleParticipantItem = CycleParticipant & {
  displayName: string;
  snapManagerName: string | null;
  /** Flag: nobody to write the manager review in the snapshot. */
  withoutManager: boolean;
};

export type CycleTransitionItem = {
  id: string;
  fromStatus: CycleStatus;
  toStatus: CycleStatus;
  actorName: string | null;
  note: string | null;
  createdAt: Date;
};

export type CycleDetail = ReviewCycle & {
  participants: CycleParticipantItem[];
  transitions: CycleTransitionItem[];
  questionCount: number;
  stats: { active: number; removed: number; withoutManager: number };
  allowedTransitions: CycleStatus[];
};

export async function getCycle(
  db: DbOrTx,
  id: string,
): Promise<CycleDetail | null> {
  if (!isUuid(id)) return null;
  const [cycle] = await db
    .select()
    .from(reviewCycle)
    .where(and(eq(reviewCycle.id, id), isNull(reviewCycle.deletedAt)));
  if (!cycle) return null;
  const reviewee = aliasedTable(person, "reviewee");
  const manager = aliasedTable(person, "manager");
  const actor = aliasedTable(person, "actor");
  const participantRows: Omit<CycleParticipantItem, "withoutManager">[] =
    await db
      .select({
        ...getTableColumns(cycleParticipant),
        displayName: reviewee.displayName,
        snapManagerName: manager.displayName,
      })
      .from(cycleParticipant)
      .innerJoin(reviewee, eq(reviewee.id, cycleParticipant.revieweePersonId))
      .leftJoin(manager, eq(manager.id, cycleParticipant.snapManagerPersonId))
      .where(eq(cycleParticipant.cycleId, id))
      .orderBy(asc(reviewee.displayName));
  const transitions: CycleTransitionItem[] = await db
    .select({
      id: cycleTransition.id,
      fromStatus: cycleTransition.fromStatus,
      toStatus: cycleTransition.toStatus,
      actorName: actor.displayName,
      note: cycleTransition.note,
      createdAt: cycleTransition.createdAt,
    })
    .from(cycleTransition)
    .leftJoin(actor, eq(actor.id, cycleTransition.actorPersonId))
    .where(eq(cycleTransition.cycleId, id))
    .orderBy(asc(cycleTransition.createdAt));
  const counts = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(questionRevision)
    .where(eq(questionRevision.cycleId, id));
  const participants = participantRows.map((r) => ({
    ...r,
    withoutManager: r.snapManagerPersonId === null,
  }));
  const active = participants.filter((p) => !p.removedAt);
  return {
    ...cycle,
    participants,
    transitions,
    questionCount: counts[0]?.count ?? 0,
    stats: {
      active: active.length,
      removed: participants.length - active.length,
      withoutManager: active.filter((p) => p.withoutManager).length,
    },
    allowedTransitions: allowedTransitions(cycle.components, cycle.status),
  };
}

export type { ParticipantFilter };
