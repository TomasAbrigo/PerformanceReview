import { and, asc, eq, inArray, isNull, ne, type SQL, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  answer,
  cycleParticipant,
  participantGoalSnapshot,
  person,
  reviewCycle,
  reviewRequest,
  type GoalStatus,
  type LocalizedText,
  type ReviewRequest,
  type ScaleSnapshot,
} from "@/db/schema";
import { clampPage, MAX_PAGE } from "@/lib/paging";
import { allOf, containsPattern, rowsOf } from "@/lib/sql";
import { isUuid } from "@/lib/uuid";
import {
  type IndividualScope,
  individualScope,
} from "@/modules/actor/individual-scope";
import type { ActorContext } from "@/modules/actor/types";
import { readableGoalIds } from "@/modules/goals/browse";
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
import { questionsFor } from "@/modules/review-core/answers";
import { visibilityContexts } from "@/modules/review-core/requests";
import { ReviewError } from "@/modules/review-core/review-errors";
import {
  canRead,
  type VisibilityContext,
} from "@/modules/review-core/visibility";
import { isDoubleBlind } from "@/modules/review-core/status";
import type { QuestionKind, QuestionRole } from "@/modules/templates/constants";
import { canOpenParticipant } from "./authz";
import type { DisplayAnswer } from "./display";
import { type Progress, type RequestState, requestState } from "./state";

/**
 * The Assessments area: a cycle's participants with where their self and
 * manager assessments stand, and one participant's form (the questions and
 * the answers people gave), next to the goals of the period. Never the
 * analysis (that is modules/analytics).
 *
 * Who reads what, in two gates. Whose rows: `individualScope` (People
 * everybody, a manager their snapshot reports and themself, an employee
 * themself, direction none). What is inside: every request and every answer
 * goes through the review module's `canRead`, the one place that decides who
 * reads what (double blind, sharing with the employee, questions hidden from
 * the employee), so no screen can show an answer `canRead` would refuse.
 */

export const ASSESSMENTS_PAGE_SIZE = 25;

const SIDES = ["self", "manager"] as const;
type Side = (typeof SIDES)[number];

/** The condition that limits participants `cp` to the scope. */
function participantScope(scope: IndividualScope): SQL {
  switch (scope.kind) {
    case "all":
      return sql`true`;
    case "team":
      return sql`(cp.reviewee_person_id = ${scope.personId}::uuid or cp.snap_manager_person_id = ${scope.personId}::uuid)`;
    case "own":
      return sql`cp.reviewee_person_id = ${scope.personId}::uuid`;
    case "none":
      throw new ReviewError("forbidden");
  }
}

// ---------------------------------------------------------------- cycles

export type AssessmentCycle = {
  id: string;
  name: string;
  localizedName: LocalizedText | null;
  status: string;
  periodStart: string;
  periodEnd: string;
  /** Participants of the cycle in the actor's scope. */
  participantCount: number;
};

/**
 * The launched cycles, latest period first. People see them all; anyone else
 * only the ones they have somebody in (themself, or their reports).
 */
export async function listAssessmentCycles(
  db: DbOrTx,
  actor: ActorContext,
): Promise<AssessmentCycle[]> {
  const scope = individualScope(actor);
  const rows = rowsOf<AssessmentCycle>(
    await db.execute(sql`
      select c.id, c.name, c.localized_name as "localizedName", c.status::text as status,
        c.period_start::text as "periodStart", c.period_end::text as "periodEnd",
        (select count(*)::int from cycle_participant cp
          where cp.cycle_id = c.id and cp.removed_at is null
            and ${participantScope(scope)}) as "participantCount"
      from review_cycle c
      where c.deleted_at is null and c.status <> 'draft'
      order by c.period_end desc, c.name, c.id`),
  );
  return scope.kind === "all"
    ? rows
    : rows.filter((c) => c.participantCount > 0);
}

// ------------------------------------------------------------------ list

export type AssessmentFilters = OrgFilters & {
  progress?: Progress;
  /** Part of the participant's name. */
  q?: string;
  /** The area on the cycle's snapshot. */
  department?: string;
  /** 1-based. */
  page?: number;
};

export type SideSummary = {
  state: RequestState;
  submittedAt: string | null;
};

export type AssessmentRow = {
  participantId: string;
  person: { id: string; name: string };
  manager: { id: string; name: string } | null;
  department: string | null;
  jobTitle: string | null;
  self: SideSummary;
  managerReview: SideSummary;
  progress: Progress;
};

export type AssessmentListPage = {
  items: AssessmentRow[];
  /** Participants matching every filter. */
  total: number;
  /** Per progress, ignoring the progress filter (the chips above the list). */
  counts: Record<Progress, number>;
  page: number;
  pageSize: number;
};

type ParticipantRow = {
  participantId: string;
  personId: string;
  personName: string;
  managerId: string | null;
  managerName: string | null;
  department: string | null;
  jobTitle: string | null;
  snapshotAsOf: string;
};

type LoadedCycle = typeof reviewCycle.$inferSelect;

/** A launched cycle; `not_found` for an unknown, deleted or draft one. */
async function loadCycle(db: DbOrTx, cycleId: string): Promise<LoadedCycle> {
  if (!isUuid(cycleId)) throw new ReviewError("not_found");
  const [cycle] = await db
    .select()
    .from(reviewCycle)
    .where(and(eq(reviewCycle.id, cycleId), isNull(reviewCycle.deletedAt)));
  if (!cycle || cycle.status === "draft") throw new ReviewError("not_found");
  return cycle;
}

const participantsFrom = sql`
  from cycle_participant cp
  join person p on p.id = cp.reviewee_person_id
  left join person mp on mp.id = cp.snap_manager_person_id
  ${orgAttributeJoins("cp", sql`cp.snapshot_as_of`)}`;

/** The request of each side to show: the submitted one, else the latest. */
function sideRequests(requests: ReviewRequest[]): Map<string, ReviewRequest> {
  const chosen = new Map<string, ReviewRequest>();
  const rank = (r: ReviewRequest) =>
    (r.status === "submitted" ? 1 : 0) * 1e15 +
    (r.submittedAt ?? r.requestedAt).getTime();
  for (const r of requests) {
    const key = `${r.participantId}:${r.relationship}`;
    const current = chosen.get(key);
    if (!current || rank(r) > rank(current)) chosen.set(key, r);
  }
  return chosen;
}

/**
 * Whether a side (`self` or `manager`) of the participant `cp` has a
 * submitted, live request THAT THE ACTOR MAY READ. Where each participant
 * stands is worked out in SQL, so the counts and the pages come from the
 * database, but it only counts what `canRead` would let the actor read, so a
 * label or a count never tells what the actor may not know (an employee that
 * their manager review is submitted before it is shared; a manager under
 * double blind that the self review is in before theirs). The conditions
 * mirror `canRead` for the participants a scope lists (the actor is the
 * reviewee or the snapshot manager); a db test checks the two agree for every
 * actor.
 *
 * - People read everything.
 * - Manager side: the snapshot manager and its reviewer read it; the reviewee
 *   only once it is shared (`shared_at`).
 * - Self side: the reviewee and its reviewer read it; the snapshot manager
 *   once the manager review is submitted when the cycle is double blind
 *   (always otherwise).
 */
function sideSubmitted(
  side: Side,
  scope: IndividualScope,
  doubleBlind: boolean,
): SQL {
  const visible = (): SQL => {
    if (scope.kind === "all" || scope.kind === "none") return sql`true`;
    const me = sql`${scope.personId}::uuid`;
    if (side === "manager") {
      return sql`(cp.snap_manager_person_id = ${me} or r.reviewer_person_id = ${me}
        or r.shared_at is not null)`;
    }
    return sql`(cp.reviewee_person_id = ${me} or r.reviewer_person_id = ${me}
      or (cp.snap_manager_person_id = ${me} and (${!doubleBlind} or exists (
        select 1 from review_request m
        where m.participant_id = cp.id and m.relationship = 'manager'
          and m.status = 'submitted' and m.deleted_at is null))))`;
  };
  return sql`exists (
    select 1 from review_request r
    where r.participant_id = cp.id and r.relationship = ${side}::review_relationship
      and r.status = 'submitted' and r.deleted_at is null and ${visible()})`;
}

/** Complete (both sides submitted), partial (one) or pending, as far as the actor may know. */
function progressSql(scope: IndividualScope, doubleBlind: boolean): SQL {
  const self = sideSubmitted("self", scope, doubleBlind);
  const manager = sideSubmitted("manager", scope, doubleBlind);
  return sql`(case
    when ${self} and ${manager} then 'complete'
    when ${self} or ${manager} then 'partial'
    else 'pending' end)`;
}

/**
 * The participants of a cycle in the actor's scope, with where each side
 * stands (as far as `canRead` lets the actor know), by name. Counts, filter
 * and pages are SQL (`group by`, `limit`/`offset`); `canRead` is asked only
 * for the requests of the rows of the page. The progress counts ignore the
 * progress filter, so the chips above the list keep their meaning when one
 * is chosen. A page past the last one is the last one.
 */
export async function listAssessmentParticipants(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
  filters: AssessmentFilters = {},
): Promise<AssessmentListPage> {
  const scope = individualScope(actor);
  const cycle = await loadCycle(db, cycleId);
  const where: SQL[] = [
    sql`cp.cycle_id = ${cycle.id}::uuid`,
    sql`cp.removed_at is null`,
    participantScope(scope),
  ];
  if (filters.q?.trim()) {
    where.push(sql`p.display_name ilike ${containsPattern(filters.q.trim())}`);
  }
  if (filters.department)
    where.push(sql`cp.snap_department = ${filters.department}`);
  where.push(...orgAttributeFilters(filters));
  const base = allOf(where);
  const progressExpr = progressSql(scope, isDoubleBlind(cycle.components));
  const matching = allOf([
    base,
    filters.progress ? sql`${progressExpr} = ${filters.progress}` : sql`true`,
  ]);
  const pageSize = ASSESSMENTS_PAGE_SIZE;
  const readPage = async (page: number) =>
    rowsOf<ParticipantRow & { progress: Progress }>(
      await db.execute(sql`
        select cp.id as "participantId", cp.reviewee_person_id as "personId",
          p.display_name as "personName", cp.snap_manager_person_id as "managerId",
          mp.display_name as "managerName", cp.snap_department as department,
          cp.snap_job_title as "jobTitle", cp.snapshot_as_of::text as "snapshotAsOf",
          ${progressExpr} as progress
        ${participantsFrom}
        where ${matching}
        order by p.display_name, cp.id
        limit ${pageSize} offset ${(page - 1) * pageSize}`),
    );

  // The counts and the page read together; a page past the last one is
  // clamped to it (read again, the rare case).
  const requested = clampPage(filters.page, MAX_PAGE * pageSize, pageSize);
  const [counted, firstTry] = await Promise.all([
    db.execute(sql`
      select ${progressExpr} as progress, count(*)::int as n
      ${participantsFrom}
      where ${base}
      group by 1`),
    readPage(requested),
  ]);
  const counts: Record<Progress, number> = {
    complete: 0,
    partial: 0,
    pending: 0,
  };
  for (const row of rowsOf<{ progress: Progress; n: number }>(counted)) {
    counts[row.progress] = row.n;
  }
  const total = filters.progress
    ? counts[filters.progress]
    : counts.complete + counts.partial + counts.pending;
  const page = clampPage(requested, total, pageSize);
  const participants = page === requested ? firstTry : await readPage(page);

  const requests = participants.length
    ? await db
        .select()
        .from(reviewRequest)
        .where(
          and(
            inArray(
              reviewRequest.participantId,
              participants.map((p) => p.participantId),
            ),
            inArray(reviewRequest.relationship, [...SIDES]),
            isNull(reviewRequest.deletedAt),
            ne(reviewRequest.status, "superseded"),
          ),
        )
    : [];
  const chosen = sideRequests(requests);
  const byParticipant = new Map(participants.map((p) => [p.participantId, p]));
  const shown = [...chosen.values()];
  const contexts = await visibilityContexts(
    db,
    actor,
    shown.map((request) =>
      visibilityRow(cycle, request, byParticipant.get(request.participantId)!),
    ),
  );
  const readable = new Map(
    shown.map((r, i) => [r.id, canRead(actor, contexts[i])]),
  );
  const summary = (participantId: string, side: Side): SideSummary => {
    const request = chosen.get(`${participantId}:${side}`) ?? null;
    return {
      state: requestState(request, !!request && !!readable.get(request.id)),
      submittedAt: request?.submittedAt?.toISOString() ?? null,
    };
  };
  return {
    items: participants.map((p) => ({
      participantId: p.participantId,
      person: { id: p.personId, name: p.personName },
      manager:
        p.managerId && p.managerName
          ? { id: p.managerId, name: p.managerName }
          : null,
      department: p.department,
      jobTitle: p.jobTitle,
      self: summary(p.participantId, "self"),
      managerReview: summary(p.participantId, "manager"),
      progress: p.progress,
    })),
    total,
    counts,
    page,
    pageSize,
  };
}

/** What canRead reads, from a request and its participant and cycle. */
function visibilityRow(
  cycle: LoadedCycle,
  request: ReviewRequest,
  p: Pick<
    ParticipantRow,
    "participantId" | "personId" | "managerId" | "snapshotAsOf"
  >,
) {
  return {
    request,
    participant: {
      id: p.participantId,
      revieweePersonId: p.personId,
      snapManagerPersonId: p.managerId,
      snapshotAsOf: p.snapshotAsOf,
      removedAt: null,
    },
    cycle,
  };
}

export type AssessmentFilterOptions = {
  departments: string[];
  org: OrgOptions;
};

/** The values of the area and org selects: what the participants in scope carry. */
export async function assessmentFilterOptions(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
): Promise<AssessmentFilterOptions> {
  const scope = individualScope(actor);
  const cycle = await loadCycle(db, cycleId);
  const rows = rowsOf<{
    department: string | null;
    account: string | null;
    project: string | null;
    dm: string | null;
    santex_lead: string | null;
  }>(
    await db.execute(sql`
      select distinct cp.snap_department as department, ${orgAttributeColumns}
      ${participantsFrom}
      where cp.cycle_id = ${cycle.id}::uuid and cp.removed_at is null
        and ${participantScope(scope)}`),
  );
  return {
    departments: [
      ...new Set(rows.flatMap((r) => (r.department ? [r.department] : []))),
    ].sort(new Intl.Collator("es").compare),
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

// ---------------------------------------------------------------- detail

export type AssessmentQuestion = {
  id: string;
  prompt: LocalizedText;
  kind: QuestionKind;
  role: QuestionRole | null;
  scale: ScaleSnapshot | null;
  choices: { value: string; label: LocalizedText }[] | null;
  visibleToReviewee: boolean;
  required: boolean;
  /** One of the cycle's own questions (Bamboo's custom ones), not a standard one. */
  custom: boolean;
  answer: (DisplayAnswer & { updatedAt: string }) | null;
};

export type AssessmentSection = {
  title: LocalizedText;
  questions: AssessmentQuestion[];
};

export type AssessmentSide = {
  relationship: Side;
  /** `none`: nobody wrote one; `locked`: it exists but is not for this reader yet. */
  state: RequestState;
  /** Who wrote it (the person themself for the self assessment). */
  author: { id: string; name: string } | null;
  submittedAt: string | null;
  /** Manager assessment: when it was shared with the reviewee. */
  sharedAt: string | null;
  /** Empty unless the reader may read the request. */
  sections: AssessmentSection[];
};

export type SnapshotGoal = {
  id: string;
  /** Null once the goal row is gone (the snapshot keeps its own copy). */
  goalId: string | null;
  /** The reader may open the goal page. */
  openable: boolean;
  title: string;
  status: GoalStatus;
  percentComplete: number;
  dueDate: string | null;
  noLongerApplicable: boolean;
};

export type AssessmentDetail = {
  cycle: {
    id: string;
    name: string;
    localizedName: LocalizedText | null;
    periodStart: string;
    periodEnd: string;
  };
  participant: {
    id: string;
    person: { id: string; name: string };
    manager: { id: string; name: string } | null;
    department: string | null;
    jobTitle: string | null;
    location: string | null;
    snapshotAsOf: string;
    removed: boolean;
  };
  /** Read as the reviewee would (never more than the actor may read). */
  employeeView: boolean;
  sides: AssessmentSide[];
  /** The goals the cycle's snapshot took for the participant. */
  goals: SnapshotGoal[];
  /** When those goals were taken (or last refreshed). */
  goalsAsOf: string | null;
};

/**
 * One participant's assessment: both sides' form with the answers the actor
 * may read, and the goals of the period. `employeeView` narrows it to what
 * the reviewee would read (the toggle People and managers use to check what
 * the employee sees): a request or answer shows only if BOTH the actor and
 * the reviewee may read it. Throws `not_found` (unknown cycle or participant)
 * or `forbidden` (outside the actor's scope).
 */
export async function getAssessment(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
  participantId: string,
  options: { employeeView?: boolean } = {},
): Promise<AssessmentDetail> {
  if (individualScope(actor).kind === "none")
    throw new ReviewError("forbidden");
  const cycle = await loadCycle(db, cycleId);
  if (!isUuid(participantId)) throw new ReviewError("not_found");
  const [participant] = await db
    .select()
    .from(cycleParticipant)
    .where(
      and(
        eq(cycleParticipant.id, participantId),
        eq(cycleParticipant.cycleId, cycle.id),
      ),
    );
  if (!participant) throw new ReviewError("not_found");
  if (!canOpenParticipant(actor, participant)) {
    throw new ReviewError("forbidden");
  }

  // Whose eyes: the actor's, and in the employee view also the reviewee's.
  const viewers: ActorContext[] = [actor];
  if (options.employeeView) {
    viewers.push({ personId: participant.revieweePersonId, role: "employee" });
  }

  const requests = sideRequests(
    await db
      .select()
      .from(reviewRequest)
      .where(
        and(
          eq(reviewRequest.participantId, participant.id),
          inArray(reviewRequest.relationship, [...SIDES]),
          isNull(reviewRequest.deletedAt),
          ne(reviewRequest.status, "superseded"),
        ),
      ),
  );
  const rows = SIDES.flatMap((side) => {
    const request = requests.get(`${participant.id}:${side}`);
    return request ? [{ request, participant, cycle }] : [];
  });
  const contextsBy = await Promise.all(
    viewers.map((viewer) => visibilityContexts(db, viewer, rows)),
  );
  /** Whether every viewer reads this request (and, with `question`, this answer). */
  const reads = (
    index: number,
    question?: { visibleToReviewee: boolean },
  ): boolean =>
    viewers.every((viewer, v) => {
      const ctx: VisibilityContext = question
        ? { ...contextsBy[v][index], questionRevision: question }
        : contextsBy[v][index];
      return canRead(viewer, ctx);
    });

  const authorIds = [
    participant.revieweePersonId,
    participant.snapManagerPersonId,
    ...rows.map((r) => r.request.reviewerPersonId),
  ].filter((id): id is string => !!id);
  const authors = new Map(
    (
      await db
        .select({ id: person.id, name: person.displayName })
        .from(person)
        .where(inArray(person.id, authorIds))
    ).map((a) => [a.id, a.name]),
  );

  const sides: AssessmentSide[] = [];
  for (const side of SIDES) {
    const request = requests.get(`${participant.id}:${side}`) ?? null;
    const index = rows.findIndex((r) => r.request === request);
    const readable = !!request && reads(index);
    const state = requestState(request, readable);
    const base: AssessmentSide = {
      relationship: side,
      state,
      author: null,
      submittedAt: null,
      sharedAt: null,
      sections: [],
    };
    if (!request || !readable) {
      sides.push(base);
      continue;
    }
    const authorId =
      request.reviewerPersonId ??
      (side === "self" ? participant.revieweePersonId : null);
    const questions = (
      await questionsFor(db, cycle.id, participant.templateGroupId, side)
    ).filter((q) => reads(index, q));
    const answers = new Map(
      (
        await db.select().from(answer).where(eq(answer.requestId, request.id))
      ).map((a) => [a.questionRevisionId, a]),
    );
    const sections: AssessmentSection[] = [];
    for (const q of questions) {
      const given = answers.get(q.id);
      let section = sections.find(
        (s) =>
          s.title.es === q.sectionTitle.es && s.title.en === q.sectionTitle.en,
      );
      if (!section) {
        section = { title: q.sectionTitle, questions: [] };
        sections.push(section);
      }
      section.questions.push({
        id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        role: q.role,
        scale: q.scale,
        choices: q.choices,
        visibleToReviewee: q.visibleToReviewee,
        required: q.required,
        custom: !!q.dimension?.startsWith("custom_"),
        answer: given
          ? {
              optionValue: given.optionValue,
              optionLabel: given.optionLabel,
              textValue: given.textValue,
              updatedAt: given.updatedAt.toISOString(),
            }
          : null,
      });
    }
    sides.push({
      ...base,
      author:
        authorId && authors.has(authorId)
          ? { id: authorId, name: authors.get(authorId)! }
          : null,
      submittedAt: request.submittedAt?.toISOString() ?? null,
      sharedAt: request.sharedAt?.toISOString() ?? null,
      sections,
    });
  }

  const snapshot = await db
    .select()
    .from(participantGoalSnapshot)
    .where(eq(participantGoalSnapshot.participantId, participant.id))
    .orderBy(
      asc(participantGoalSnapshot.dueDate),
      asc(participantGoalSnapshot.title),
      asc(participantGoalSnapshot.id),
    );
  const openable = await readableGoalIds(
    db,
    actor,
    snapshot.flatMap((g) => (g.goalId ? [g.goalId] : [])),
  );
  const asOf = snapshot
    .map((g) => g.refreshedAt ?? g.capturedAt)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    cycle: {
      id: cycle.id,
      name: cycle.name,
      localizedName: cycle.localizedName,
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
    },
    participant: {
      id: participant.id,
      person: {
        id: participant.revieweePersonId,
        name: authors.get(participant.revieweePersonId) ?? "",
      },
      manager:
        participant.snapManagerPersonId &&
        authors.has(participant.snapManagerPersonId)
          ? {
              id: participant.snapManagerPersonId,
              name: authors.get(participant.snapManagerPersonId)!,
            }
          : null,
      department: participant.snapDepartment,
      jobTitle: participant.snapJobTitle,
      location: participant.snapLocation,
      snapshotAsOf: participant.snapshotAsOf,
      removed: participant.removedAt !== null,
    },
    employeeView: !!options.employeeView,
    sides,
    goals: snapshot.map((g) => ({
      id: g.id,
      goalId: g.goalId,
      openable: !!g.goalId && openable.has(g.goalId),
      title: g.title,
      status: g.status,
      percentComplete: g.percentComplete,
      dueDate: g.dueDate,
      noLongerApplicable: g.noLongerApplicable,
    })),
    goalsAsOf: asOf?.toISOString() ?? null,
  };
}
