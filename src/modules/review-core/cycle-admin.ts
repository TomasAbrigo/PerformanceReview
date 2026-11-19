import {
  aliasedTable,
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  person,
  question,
  questionRevision,
  ratingScaleOption,
  reviewCycle,
  type ReviewCycle,
  reviewRequest,
  type ReviewRequest,
  reviewTemplate,
  templateSection,
} from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import { requireHr } from "@/modules/actor/access";
import type { ActorContext } from "@/modules/actor/types";
import { snapshotDateFor } from "@/modules/import-history/semester";
import { todayLocal } from "@/modules/org-history/dates";
import { jobsAsOf } from "@/modules/org-history/queries";
import { activeEmploymentCteOn } from "@/modules/people/employment";
import { snapshotGoalsForParticipants } from "./goal-snapshot";
import { ReviewError } from "./review-errors";
import { snapshots } from "./service";
import type { CycleComponents } from "./status";

/** The template a new cycle uses unless People pick another one. */
export const DEFAULT_TEMPLATE_KEY = "santex_semester";

export type CreateCycleInput = {
  name: string;
  periodStart: string;
  periodEnd: string;
  /** Defaults to the "Evaluación semestral Santex" system template. */
  templateId?: string | null;
  /** Defaults to the end of the period, or today while it is not over. */
  snapshotDate?: string;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIso = (v: string) =>
  ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

const live = (id: string) =>
  and(eq(reviewCycle.id, id), isNull(reviewCycle.deletedAt));

async function loadCycle(db: DbOrTx, cycleId: string): Promise<ReviewCycle> {
  if (!isUuid(cycleId)) throw new ReviewError("not_found");
  const [cycle] = await db.select().from(reviewCycle).where(live(cycleId));
  if (!cycle) throw new ReviewError("not_found");
  return cycle;
}

/** A cycle that accepts answers: open (not a draft, not closed). */
const isOpen = (status: ReviewCycle["status"]) =>
  status !== "draft" && status !== "closed";

/**
 * Throws `invalid_state` unless the cycle is open: a draft has no requests to
 * answer yet and a closed one rejects every submission. Capture (drafts,
 * submit, share) calls it before writing.
 */
export async function assertCycleOpen(
  db: DbOrTx,
  cycleId: string,
): Promise<void> {
  const cycle = await loadCycle(db, cycleId);
  if (!isOpen(cycle.status)) throw new ReviewError("invalid_state");
}

/** Creates a draft cycle (People only) on the Santex template by default. */
export async function createCycle(
  db: DbOrTx,
  actor: ActorContext,
  input: CreateCycleInput,
): Promise<ReviewCycle> {
  requireHr(actor);
  const name = input.name.trim();
  const issues = [
    ...(name ? [] : [{ path: "name", message: "required" }]),
    ...(isIso(input.periodStart)
      ? []
      : [{ path: "periodStart", message: "invalid_date" }]),
    ...(isIso(input.periodEnd)
      ? []
      : [{ path: "periodEnd", message: "invalid_date" }]),
  ];
  if (issues.length === 0 && input.periodEnd < input.periodStart) {
    issues.push({ path: "periodEnd", message: "before_start" });
  }
  if (input.snapshotDate !== undefined && !isIso(input.snapshotDate)) {
    issues.push({ path: "snapshotDate", message: "invalid_date" });
  }
  let templateId = input.templateId ?? null;
  if (templateId === null) {
    const [santex] = await db
      .select({ id: reviewTemplate.id })
      .from(reviewTemplate)
      .where(
        and(
          eq(reviewTemplate.systemKey, DEFAULT_TEMPLATE_KEY),
          isNull(reviewTemplate.deletedAt),
        ),
      );
    templateId = santex?.id ?? null;
    if (!templateId) issues.push({ path: "templateId", message: "required" });
  } else {
    const [found] = await db
      .select({ id: reviewTemplate.id })
      .from(reviewTemplate)
      .where(
        and(
          eq(reviewTemplate.id, templateId),
          isNull(reviewTemplate.deletedAt),
        ),
      );
    if (!found) issues.push({ path: "templateId", message: "not_found" });
  }
  if (issues.length) throw new ReviewError("validation", issues);

  const components: CycleComponents = {
    self: true,
    manager: true,
    peer: false,
    upward: false,
    calibration: false,
  };
  const [cycle] = await db
    .insert(reviewCycle)
    .values({
      name,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      snapshotDate: input.snapshotDate ?? snapshotDateFor(input.periodEnd),
      status: "draft",
      components,
      anonymity: { peer: "transparent", upward: "transparent" },
      templateId,
    })
    .returning();
  return cycle;
}

export type Candidate = {
  personId: string;
  displayName: string;
  department: string | null;
  managerName: string | null;
};

/**
 * The people who can be chosen as participants: active employees as of
 * `date` (default today), with their area and manager on that date. People only.
 */
export async function listCandidates(
  db: DbOrTx,
  actor: ActorContext,
  date: string = todayLocal(),
): Promise<Candidate[]> {
  requireHr(actor);
  const rows = (await db.execute(sql`
    with ${activeEmploymentCteOn(date)}
    select p.id as "personId", p.display_name as "displayName"
    from active_employment ae
    join person p on p.id = ae.person_id
    order by p.display_name
  `)) as unknown as { personId: string; displayName: string }[];
  const ids = rows.map((r) => r.personId);
  const jobs = await jobsAsOf(db, ids, date);
  const managerIds = [
    ...new Set(
      [...jobs.values()]
        .map((j) => j.managerPersonId)
        .filter((m): m is string => m !== null),
    ),
  ];
  const names = new Map(
    managerIds.length
      ? (
          await db
            .select({ id: person.id, name: person.displayName })
            .from(person)
            .where(inArray(person.id, managerIds))
        ).map((m) => [m.id, m.name])
      : [],
  );
  return rows.map((r) => {
    const job = jobs.get(r.personId);
    return {
      ...r,
      department: job?.department ?? null,
      managerName: job?.managerPersonId
        ? (names.get(job.managerPersonId) ?? null)
        : null,
    };
  });
}

/** Copies a template's questions (and their scales) as the cycle's revisions. */
async function copyTemplateQuestions(
  tx: DbOrTx,
  cycleId: string,
  templateId: string,
) {
  const rows = await tx
    .select({ section: templateSection, question })
    .from(question)
    .innerJoin(templateSection, eq(templateSection.id, question.sectionId))
    .where(eq(templateSection.templateId, templateId))
    .orderBy(asc(templateSection.sort), asc(question.sort));
  if (rows.length === 0) return;
  const scaleIds = [
    ...new Set(
      rows.map((r) => r.question.scaleId).filter((v): v is string => !!v),
    ),
  ];
  const options = scaleIds.length
    ? await tx
        .select()
        .from(ratingScaleOption)
        .where(inArray(ratingScaleOption.scaleId, scaleIds))
        .orderBy(asc(ratingScaleOption.sort))
    : [];
  await tx.insert(questionRevision).values(
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
      dimension: q.dimension,
      yesNo: q.yesNo,
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
 * Replaces the participants of a draft cycle with `personIds`, each with the
 * org snapshot as of the cycle's snapshot date, so People see before opening
 * who has no manager. Once the cycle is open, use addParticipant and
 * removeParticipant. People only.
 */
export async function setParticipants(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
  personIds: string[],
): Promise<void> {
  requireHr(actor);
  const unique = [...new Set(personIds)];
  if (unique.some((id) => !isUuid(id))) {
    throw new ReviewError("validation", [
      { path: "personIds", message: "invalid" },
    ]);
  }
  await db.transaction(async (tx) => {
    const cycle = await loadCycle(tx, cycleId);
    if (cycle.status !== "draft") throw new ReviewError("invalid_state");
    await tx
      .delete(cycleParticipant)
      .where(eq(cycleParticipant.cycleId, cycleId));
    if (unique.length === 0) return;
    const known = await tx
      .select({ id: person.id })
      .from(person)
      .where(inArray(person.id, unique));
    if (known.length !== unique.length) {
      throw new ReviewError("validation", [
        { path: "personIds", message: "unknown_person" },
      ]);
    }
    await tx
      .insert(cycleParticipant)
      .values(await snapshots(tx, cycleId, unique, cycle.snapshotDate));
  });
}

/** The requests of participants: self, and the manager of the snapshot. */
function requestsFor(
  cycle: ReviewCycle,
  participants: (typeof cycleParticipant.$inferSelect)[],
) {
  return participants.flatMap((p) => [
    ...(cycle.components.self
      ? [
          {
            cycleId: cycle.id,
            participantId: p.id,
            reviewerPersonId: p.revieweePersonId,
            relationship: "self" as const,
          },
        ]
      : []),
    ...(cycle.components.manager
      ? [
          {
            cycleId: cycle.id,
            participantId: p.id,
            reviewerPersonId: p.snapManagerPersonId,
            reviewerMissing: p.snapManagerPersonId === null,
            relationship: "manager" as const,
          },
        ]
      : []),
  ]);
}

/**
 * Opens a draft cycle (People only): freezes the template's questions, takes
 * the snapshot (manager, area, job) and the goals of every participant and
 * creates their `self` and `manager` requests (`native`). A participant
 * without a manager gets a manager request flagged `reviewer_missing`.
 */
export async function launchCycle(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
): Promise<ReviewCycle> {
  requireHr(actor);
  return db.transaction(async (tx) => {
    // Lock the cycle: two launches must not both create requests.
    await tx.execute(
      sql`select 1 from review_cycle where id = ${isUuid(cycleId) ? cycleId : null} for update`,
    );
    const cycle = await loadCycle(tx, cycleId);
    if (cycle.status !== "draft") throw new ReviewError("invalid_state");
    if (!cycle.templateId) {
      throw new ReviewError("validation", [
        { path: "templateId", message: "required" },
      ]);
    }
    const existing = await tx
      .select()
      .from(cycleParticipant)
      .where(
        and(
          eq(cycleParticipant.cycleId, cycleId),
          isNull(cycleParticipant.removedAt),
        ),
      );
    if (existing.length === 0) {
      throw new ReviewError("validation", [
        { path: "personIds", message: "required" },
      ]);
    }
    await copyTemplateQuestions(tx, cycleId, cycle.templateId);
    // Re-take the snapshot: the org may have changed since they were chosen.
    const fresh = await snapshots(
      tx,
      cycleId,
      existing.map((p) => p.revieweePersonId),
      cycle.snapshotDate,
    );
    const participants: (typeof cycleParticipant.$inferSelect)[] = [];
    for (const row of fresh) {
      const [updated] = await tx
        .update(cycleParticipant)
        .set(row)
        .where(
          and(
            eq(cycleParticipant.cycleId, cycleId),
            eq(cycleParticipant.revieweePersonId, row.revieweePersonId),
          ),
        )
        .returning();
      participants.push(updated);
    }
    await snapshotGoalsForParticipants(
      tx,
      participants.map((p) => p.id),
    );
    const requests = requestsFor(cycle, participants);
    if (requests.length) await tx.insert(reviewRequest).values(requests);
    const [opened] = await tx
      .update(reviewCycle)
      .set({ status: "collecting", launchedAt: new Date() })
      .where(eq(reviewCycle.id, cycleId))
      .returning();
    return opened;
  });
}

/** Closes an open cycle (People only): no more answers can be submitted. */
export async function closeCycle(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
): Promise<ReviewCycle> {
  requireHr(actor);
  const cycle = await loadCycle(db, cycleId);
  if (!isOpen(cycle.status)) throw new ReviewError("invalid_state");
  const [closed] = await db
    .update(reviewCycle)
    .set({ status: "closed" })
    .where(eq(reviewCycle.id, cycleId))
    .returning();
  return closed;
}

/**
 * Adds a person to an open cycle (People only), with the snapshot as of now
 * (never after the period's end) and their requests. A person who is already
 * in is left as is; one removed earlier comes back with a fresh snapshot and
 * their old requests.
 */
export async function addParticipant(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
  personId: string,
): Promise<void> {
  requireHr(actor);
  if (!isUuid(personId)) throw new ReviewError("not_found");
  await db.transaction(async (tx) => {
    const cycle = await loadCycle(tx, cycleId);
    if (!isOpen(cycle.status)) throw new ReviewError("invalid_state");
    const [known] = await tx
      .select({ id: person.id })
      .from(person)
      .where(eq(person.id, personId));
    if (!known) throw new ReviewError("not_found");
    const [current] = await tx
      .select()
      .from(cycleParticipant)
      .where(
        and(
          eq(cycleParticipant.cycleId, cycleId),
          eq(cycleParticipant.revieweePersonId, personId),
        ),
      );
    if (current && !current.removedAt) return;
    const [row] = await snapshots(
      tx,
      cycleId,
      [personId],
      snapshotDateFor(cycle.periodEnd),
    );
    const [participant] = current
      ? await tx
          .update(cycleParticipant)
          .set({ ...row, removedAt: null, addedAt: new Date() })
          .where(eq(cycleParticipant.id, current.id))
          .returning()
      : await tx.insert(cycleParticipant).values(row).returning();
    await snapshotGoalsForParticipants(tx, [participant.id]);
    if (current) return; // its requests stay (answers included)
    const requests = requestsFor(cycle, [participant]);
    if (requests.length) await tx.insert(reviewRequest).values(requests);
  });
}

/** Removes a participant from an open cycle (People only); their data stays. */
export async function removeParticipant(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
  personId: string,
): Promise<void> {
  requireHr(actor);
  if (!isUuid(personId)) throw new ReviewError("not_found");
  const cycle = await loadCycle(db, cycleId);
  if (!isOpen(cycle.status)) throw new ReviewError("invalid_state");
  const removed = await db
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
  if (removed.length === 0) throw new ReviewError("not_found");
}

/**
 * Sends a submitted request back to draft (People only), clearing its
 * submission and sharing, so the person can correct it. Only while the
 * cycle is open.
 */
export async function reopenRequest(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
): Promise<ReviewRequest> {
  requireHr(actor);
  if (!isUuid(requestId)) throw new ReviewError("not_found");
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(reviewRequest)
      .where(eq(reviewRequest.id, requestId));
    if (!request) throw new ReviewError("not_found");
    const cycle = await loadCycle(tx, request.cycleId);
    if (!isOpen(cycle.status) || request.status !== "submitted") {
      throw new ReviewError("invalid_state");
    }
    const [reopened] = await tx
      .update(reviewRequest)
      .set({ status: "draft", submittedAt: null, sharedAt: null })
      .where(eq(reviewRequest.id, requestId))
      .returning();
    return reopened;
  });
}

export type CycleProgress = Record<
  "self" | "manager",
  { submitted: number; total: number }
>;

/** Submitted vs total self and manager requests of the active participants. */
export async function cycleProgress(
  db: DbOrTx,
  cycleId: string,
): Promise<CycleProgress> {
  const rows = await db
    .select({
      relationship: reviewRequest.relationship,
      submitted: sql<number>`count(*) filter (where ${reviewRequest.status} = 'submitted')::int`,
      total: count(),
    })
    .from(reviewRequest)
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .where(
      and(
        eq(reviewRequest.cycleId, cycleId),
        isNull(cycleParticipant.removedAt),
        inArray(reviewRequest.relationship, ["self", "manager"]),
        ne(reviewRequest.status, "superseded"),
      ),
    )
    .groupBy(reviewRequest.relationship);
  const progress: CycleProgress = {
    self: { submitted: 0, total: 0 },
    manager: { submitted: 0, total: 0 },
  };
  for (const r of rows) {
    if (r.relationship === "self" || r.relationship === "manager") {
      progress[r.relationship] = { submitted: r.submitted, total: r.total };
    }
  }
  return progress;
}

export type CycleRequestItem = {
  id: string;
  revieweeName: string;
  relationship: ReviewRequest["relationship"];
  reviewerName: string | null;
  reviewerMissing: boolean;
  status: ReviewRequest["status"];
  /** The reviewee left the cycle: the request stays but cannot be acted on. */
  removed: boolean;
};

/** The self and manager requests of a cycle, by reviewee name (People screen). */
export async function listCycleRequests(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
): Promise<CycleRequestItem[]> {
  requireHr(actor);
  if (!isUuid(cycleId)) return [];
  const reviewee = aliasedTable(person, "reviewee");
  const reviewer = aliasedTable(person, "reviewer");
  const rows: (Omit<CycleRequestItem, "removed"> & {
    removedAt: Date | null;
  })[] = await db
    .select({
      id: reviewRequest.id,
      revieweeName: reviewee.displayName,
      relationship: reviewRequest.relationship,
      reviewerName: reviewer.displayName,
      reviewerMissing: reviewRequest.reviewerMissing,
      status: reviewRequest.status,
      removedAt: cycleParticipant.removedAt,
    })
    .from(reviewRequest)
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .innerJoin(reviewee, eq(reviewee.id, cycleParticipant.revieweePersonId))
    .leftJoin(reviewer, eq(reviewer.id, reviewRequest.reviewerPersonId))
    .where(
      and(
        eq(reviewRequest.cycleId, cycleId),
        inArray(reviewRequest.relationship, ["self", "manager"]),
      ),
    )
    .orderBy(asc(reviewee.displayName), asc(reviewRequest.relationship));
  return rows.map((r) => ({
    id: r.id,
    revieweeName: r.revieweeName,
    relationship: r.relationship,
    reviewerName: r.reviewerName,
    reviewerMissing: r.reviewerMissing,
    status: r.status,
    removed: !!r.removedAt,
  }));
}
