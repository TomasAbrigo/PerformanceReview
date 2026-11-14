import { and, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { LocalizedText, ScaleSnapshot } from "@/db/schema";
import { rowsOf } from "@/lib/sql";
import { isUuid } from "@/lib/uuid";
import { DEFAULT_ACTOR, type ActorContext } from "@/modules/actor/types";
import type { FinalRatingStage } from "@/modules/review-core/calibration-constants";
import type { RequestStatus } from "@/modules/review-core/request-status";
import { loadRequest } from "@/modules/review-core/requests";
import { ReviewError } from "@/modules/review-core/review-errors";
import type { CycleAnonymity, CycleStatus } from "@/modules/review-core/status";
import { canRead, reviewerVisible } from "@/modules/review-core/visibility";
import type {
  QuestionKind,
  QuestionRole,
  Relationship,
} from "@/modules/templates/constants";
import { forbidden, notFound } from "../errors";
import { encodeCursor, pageOf, type Page } from "../pagination";
import {
  afterNId,
  afterTsId,
  identityCtes,
  iso,
  personRef,
  type PersonRef,
} from "./shared";

/**
 * Review requests, their answers and the frozen questions, for the JSON API
 * and the answers/requests CSV exports.
 *
 * Reading as: the API has no actor, so every function takes the `actor` it
 * reads as. The default is HR (everything, see `scope.ts`); any other actor
 * is filtered through `canRead` of the review module, the one place that
 * decides who reads what.
 *
 * Anonymity is applied here, to every row, so no endpoint or export can leak
 * it: with peer/upward `fully_anonymous` the reviewer is never returned,
 * whoever reads (HR, and even the author, included).
 *
 * The participant's current rating (`v_current_rating`: override >
 * calibrated > manager > computed) rides along on every request, but only HR
 * reads it: a rating before calibration is published is not for the reviewee,
 * the manager or the peers (the screens decide that with myPublishedRating).
 */

/** HR, no person: the default scope of the API. */
export const HR_SCOPE: ActorContext = DEFAULT_ACTOR;

const uuidList = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/** Whether `actor` may read request `id`; HR always (canRead says so). */
async function canReadRequest(
  db: DbOrTx,
  actor: ActorContext,
  id: string,
): Promise<boolean> {
  if (actor.role === "hr") return true;
  try {
    await loadRequest(db, actor, id);
    return true;
  } catch (error) {
    if (
      error instanceof ReviewError &&
      (error.code === "forbidden" || error.code === "not_found")
    ) {
      return false;
    }
    throw error;
  }
}

/**
 * A page of the rows `actor` may read. The keyset runs over the rows as
 * stored, the readable ones are picked from each batch: a page is full (up to
 * `limit`) whenever there are enough readable rows after the cursor, and the
 * cursor is the key of the last row returned, so the next page resumes right
 * after it. HR reads every row: one batch.
 */
async function readablePage<T>(input: {
  limit: number;
  cursor: string | null | undefined;
  fetch: (cursor: string | null, take: number) => Promise<T[]>;
  keep: (row: T) => Promise<boolean> | boolean;
  cursorOf: (row: T) => string;
}): Promise<Page<T>> {
  const { limit, fetch, keep, cursorOf } = input;
  const kept: T[] = [];
  let cursor = input.cursor ?? null;
  for (;;) {
    const batch = await fetch(cursor, limit + 1);
    for (const row of batch) {
      if (await keep(row)) kept.push(row);
      if (kept.length > limit) break;
    }
    const last = batch.at(-1);
    if (kept.length > limit || batch.length <= limit || !last) break;
    cursor = cursorOf(last);
  }
  return pageOf(kept, limit, cursorOf);
}

// -------------------------------------------------------------- requests

/** A participant's current final rating (the v_current_rating row). */
export type CurrentRatingRow = {
  stage: FinalRatingStage;
  optionValue: number;
  optionLabel: string | null;
  normalized: number | null;
  createdAt: string;
};

export type RequestRow = {
  id: string;
  sourceSystem: string;
  sourceId: string | null;
  cycleId: string;
  cycleSourceSystem: string;
  cycleSourceId: string | null;
  cycleName: string;
  cycleStatus: CycleStatus;
  cycleAnonymity: CycleAnonymity;
  participantId: string;
  participantRemovedAt: string | null;
  /** The participant's current rating; null when there is none or the actor is not HR. */
  currentRating: CurrentRatingRow | null;
  /** The person reviewed. */
  reviewee: PersonRef;
  revieweeEmployeeNumber: string | null;
  /** The org data frozen at `snapshotAsOf`. */
  snapshotAsOf: string;
  snapManager: PersonRef | null;
  snapDepartment: string | null;
  snapDivision: string | null;
  snapJobTitle: string | null;
  snapLocation: string | null;
  snapJobHistoryId: string | null;
  relationship: Relationship;
  status: RequestStatus;
  /** Who writes it; null when there is none (see reviewerMissing) or when anonymity hides them. */
  reviewer: PersonRef | null;
  /** False when the reviewer may not be told (peer/upward anonymity): `reviewer` is then null. */
  reviewerVisible: boolean;
  reviewerMissing: boolean;
  reviewerMismatch: boolean;
  /** A second manager request next to the participant's primary one (#17). */
  additional: boolean;
  /** HR picked this reviewer on purpose (alternate assessor, #17). */
  assignedByHr: boolean;
  /** HR completed the review in the reviewer's name (#17). */
  submittedOnBehalf: boolean;
  requestedAt: string;
  submittedAt: string | null;
  declinedAt: string | null;
  unlockedAt: string | null;
  /** Manager reviews: when it was shared with the reviewee. */
  sharedAt: string | null;
  answerCount: number;
  createdAt: string;
  updatedAt: string;
};

type RawRequest = Omit<
  RequestRow,
  "reviewee" | "snapManager" | "reviewer" | "reviewerVisible" | "currentRating"
> & {
  ratingStage: FinalRatingStage | null;
  ratingValue: number | null;
  ratingLabel: string | null;
  ratingNormalized: number | null;
  ratingAt: string | null;
  revieweeId: string;
  revieweeSystem: string | null;
  revieweeBambooId: string | null;
  revieweeName: string;
  managerId: string | null;
  managerSystem: string | null;
  managerBambooId: string | null;
  managerName: string | null;
  reviewerId: string | null;
  reviewerSystem: string | null;
  reviewerBambooId: string | null;
  reviewerName: string | null;
};

/**
 * Whether `actor` may be told who wrote a request. Peer/upward follow the
 * cycle's anonymity (`reviewerVisible` of the review module), with one rule
 * on top: `fully_anonymous` never shows the reviewer through the API.
 */
export function reviewerShown(
  actor: ActorContext,
  r: Pick<
    RawRequest,
    | "relationship"
    | "status"
    | "reviewerId"
    | "revieweeId"
    | "managerId"
    | "cycleStatus"
    | "cycleAnonymity"
  >,
): boolean {
  if (r.relationship === "peer" || r.relationship === "upward") {
    const mode = r.cycleAnonymity?.[r.relationship] ?? "fully_anonymous";
    if (mode === "fully_anonymous") return false;
  }
  return reviewerVisible(actor, {
    request: {
      relationship: r.relationship,
      reviewerPersonId: r.reviewerId,
      status: r.status,
    },
    participant: {
      revieweePersonId: r.revieweeId,
      snapManagerPersonId: r.managerId,
    },
    cycle: { status: r.cycleStatus, anonymity: r.cycleAnonymity },
  });
}

function toRequestRow(raw: RawRequest, actor: ActorContext): RequestRow {
  const {
    revieweeId,
    revieweeSystem,
    revieweeBambooId,
    revieweeName,
    managerId,
    managerSystem,
    managerBambooId,
    managerName,
    reviewerId,
    reviewerSystem,
    reviewerBambooId,
    reviewerName,
    ratingStage,
    ratingValue,
    ratingLabel,
    ratingNormalized,
    ratingAt,
    ...row
  } = raw;
  const shown = reviewerShown(actor, raw);
  return {
    ...row,
    currentRating:
      actor.role === "hr" && ratingStage && ratingValue !== null && ratingAt
        ? {
            stage: ratingStage,
            optionValue: ratingValue,
            optionLabel: ratingLabel,
            normalized: ratingNormalized,
            createdAt: ratingAt,
          }
        : null,
    reviewee: personRef(
      revieweeId,
      revieweeSystem,
      revieweeBambooId,
      revieweeName,
    )!,
    snapManager: personRef(
      managerId,
      managerSystem,
      managerBambooId,
      managerName,
    ),
    reviewer: shown
      ? personRef(reviewerId, reviewerSystem, reviewerBambooId, reviewerName)
      : null,
    reviewerVisible: shown,
  };
}

async function selectRequests(
  db: DbOrTx,
  where: SQL,
  limit: number,
  actor: ActorContext,
): Promise<RequestRow[]> {
  const raw = rowsOf<RawRequest>(
    await db.execute(sql`
      with ${identityCtes}
      select r.id, r.source_system::text as "sourceSystem", r.source_id as "sourceId",
        r.cycle_id as "cycleId", c.source_system::text as "cycleSourceSystem",
        c.source_id as "cycleSourceId", c.name as "cycleName",
        c.status::text as "cycleStatus", c.anonymity as "cycleAnonymity",
        r.participant_id as "participantId",
        ${iso("cp.removed_at")} as "participantRemovedAt",
        cp.reviewee_person_id as "revieweeId", p.display_name as "revieweeName",
        bi.source_system as "revieweeSystem", bi.value as "revieweeBambooId",
        en.value as "revieweeEmployeeNumber",
        cp.snapshot_as_of::text as "snapshotAsOf",
        cp.snap_manager_person_id as "managerId", mp.display_name as "managerName",
        mbi.source_system as "managerSystem", mbi.value as "managerBambooId",
        cp.snap_department as "snapDepartment", cp.snap_division as "snapDivision",
        cp.snap_job_title as "snapJobTitle", cp.snap_location as "snapLocation",
        cp.snap_job_history_id as "snapJobHistoryId",
        r.relationship::text as relationship, r.status::text as status,
        r.reviewer_person_id as "reviewerId", rp.display_name as "reviewerName",
        rbi.source_system as "reviewerSystem", rbi.value as "reviewerBambooId",
        r.reviewer_missing as "reviewerMissing",
        r.reviewer_mismatch as "reviewerMismatch",
        r.additional, r.assigned_by_hr as "assignedByHr",
        r.submitted_on_behalf as "submittedOnBehalf",
        ${iso("r.requested_at")} as "requestedAt",
        ${iso("r.submitted_at")} as "submittedAt",
        ${iso("r.declined_at")} as "declinedAt",
        ${iso("r.unlocked_at")} as "unlockedAt",
        ${iso("r.shared_at")} as "sharedAt",
        cr.stage::text as "ratingStage", cr.option_value::float8 as "ratingValue",
        cr.option_label as "ratingLabel", cr.normalized::float8 as "ratingNormalized",
        ${iso("cr.created_at")} as "ratingAt",
        (select count(*)::int from answer a where a.request_id = r.id) as "answerCount",
        ${iso("r.created_at")} as "createdAt", ${iso("r.updated_at")} as "updatedAt"
      from review_request r
      join review_cycle c on c.id = r.cycle_id and c.deleted_at is null
      join cycle_participant cp on cp.id = r.participant_id
      join person p on p.id = cp.reviewee_person_id
      left join bamboo_identity bi on bi.person_id = cp.reviewee_person_id
      left join employee_number en on en.person_id = cp.reviewee_person_id
      left join person mp on mp.id = cp.snap_manager_person_id
      left join bamboo_identity mbi on mbi.person_id = cp.snap_manager_person_id
      left join v_current_rating cr on cr.participant_id = r.participant_id
      left join person rp on rp.id = r.reviewer_person_id
      left join bamboo_identity rbi on rbi.person_id = r.reviewer_person_id
      where r.deleted_at is null and ${where}
      order by r.created_at, r.id
      limit ${limit}
    `),
  );
  return raw.map((row) => toRequestRow(row, actor));
}

export type ListRequestsInput = {
  limit: number;
  cursor?: string | null;
  cycleId?: string;
  relationship?: Relationship;
  status?: RequestStatus;
  participantId?: string;
  /** Who reads (default HR). */
  actor?: ActorContext;
};

/**
 * Requests (never the deleted ones) the `actor` may read, oldest first by
 * (created_at, id): the creation time never changes, so a request that
 * arrives later never shifts the pages already read. Requests of removed
 * participants are included (see `participantRemovedAt`).
 */
export async function listRequestRows(
  db: DbOrTx,
  {
    limit,
    cursor,
    cycleId,
    relationship,
    status,
    participantId,
    actor = HR_SCOPE,
  }: ListRequestsInput,
): Promise<Page<RequestRow>> {
  // An id that cannot exist matches nothing (and must not reach a uuid cast).
  if (
    (cycleId && !isUuid(cycleId)) ||
    (participantId && !isUuid(participantId))
  ) {
    return { items: [], nextCursor: null };
  }
  return readablePage({
    limit,
    cursor,
    fetch: (position, take) =>
      selectRequests(
        db,
        and(
          afterTsId("r.created_at", "r.id", position),
          cycleId ? sql`r.cycle_id = ${cycleId}::uuid` : undefined,
          relationship
            ? sql`r.relationship = ${relationship}::review_relationship`
            : undefined,
          status ? sql`r.status = ${status}::review_request_status` : undefined,
          participantId
            ? sql`r.participant_id = ${participantId}::uuid`
            : undefined,
        ) ?? sql`true`,
        take,
        actor,
      ),
    keep: (row) => canReadRequest(db, actor, row.id),
    cursorOf: (r) => encodeCursor([r.createdAt, r.id]),
  });
}

/**
 * One request; null if unknown (or deleted). Throws a 403 when `actor` may
 * not read it (never for HR).
 */
export async function getRequestRow(
  db: DbOrTx,
  id: string,
  actor: ActorContext = HR_SCOPE,
): Promise<RequestRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await selectRequests(db, sql`r.id = ${id}::uuid`, 1, actor);
  if (!row) return null;
  if (!(await canReadRequest(db, actor, id))) {
    throw forbidden("The person cannot read this request.");
  }
  return row;
}

/** Whether a (not deleted) cycle with this id exists. */
export async function cycleExists(db: DbOrTx, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return (
    rowsOf(
      await db.execute(
        sql`select 1 from review_cycle where id = ${id}::uuid and deleted_at is null`,
      ),
    ).length > 0
  );
}

// --------------------------------------------------------------- answers

export type AnswerRow = {
  id: string;
  requestId: string;
  question: {
    /** The question revision. */
    id: string;
    prompt: LocalizedText;
    kind: QuestionKind;
    role: QuestionRole | null;
    visibleToReviewee: boolean;
    sort: number;
  };
  /** Rating: the chosen scale value. */
  optionValue: number | null;
  /** Rating: the option's label (es); single choice: the chosen choice's value. */
  optionLabel: string | null;
  /** Rating: 0-1, comparable across scales. */
  normalized: number | null;
  text: string | null;
  updatedAt: string;
};

type RawAnswer = Omit<AnswerRow, "question"> & {
  questionId: string;
  prompt: LocalizedText;
  kind: QuestionKind;
  role: QuestionRole | null;
  visibleToReviewee: boolean;
  sort: number;
};

async function selectAnswers(
  db: DbOrTx,
  where: SQL,
  order: SQL,
  limit?: number,
): Promise<AnswerRow[]> {
  const raw = rowsOf<RawAnswer>(
    await db.execute(sql`
      select a.id, a.request_id as "requestId", qr.id as "questionId",
        qr.prompt, qr.kind, qr.role, qr.visible_to_reviewee as "visibleToReviewee",
        qr.sort, a.option_value::float8 as "optionValue",
        a.option_label as "optionLabel", a.normalized::float8 as normalized,
        a.text_value as text, ${iso("a.updated_at")} as "updatedAt"
      from answer a
      join question_revision qr on qr.id = a.question_revision_id
      where ${where}
      order by ${order}
      ${limit === undefined ? sql`` : sql`limit ${limit}`}
    `),
  );
  return raw.map(
    ({ questionId, prompt, kind, role, visibleToReviewee, sort, ...row }) => ({
      ...row,
      question: { id: questionId, prompt, kind, role, visibleToReviewee, sort },
    }),
  );
}

type QuestionGate = (q: { visibleToReviewee: boolean }) => boolean;

/**
 * Which questions of request `requestId` `actor` may read (canRead with the
 * question: the reviewee does not see the questions hidden from them). HR
 * reads all; a person who cannot read the request at all is a 403.
 */
async function questionGate(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
): Promise<QuestionGate> {
  if (actor.role === "hr") return () => true;
  try {
    const { visibility } = await loadRequest(db, actor, requestId);
    return (q) => canRead(actor, { ...visibility, questionRevision: q });
  } catch (error) {
    if (error instanceof ReviewError && error.code === "forbidden") {
      throw forbidden("The person cannot read this request.");
    }
    if (error instanceof ReviewError && error.code === "not_found") {
      throw notFound("Request");
    }
    throw error;
  }
}

/**
 * The answers of one request in question order (sort, revision id), as far as
 * `actor` may read them; null if the request is unknown (or deleted). Throws
 * a 403 when the actor may not read the request.
 */
export async function listAnswerRows(
  db: DbOrTx,
  requestId: string,
  {
    limit,
    cursor,
    actor = HR_SCOPE,
  }: { limit: number; cursor?: string | null; actor?: ActorContext },
): Promise<Page<AnswerRow> | null> {
  if (!isUuid(requestId)) return null;
  const exists = rowsOf(
    await db.execute(sql`
      select 1 from review_request r
      join review_cycle c on c.id = r.cycle_id and c.deleted_at is null
      where r.id = ${requestId}::uuid and r.deleted_at is null
    `),
  );
  if (exists.length === 0) return null;
  const gate = await questionGate(db, actor, requestId);
  return readablePage({
    limit,
    cursor,
    fetch: (position, take) =>
      selectAnswers(
        db,
        and(
          sql`a.request_id = ${requestId}::uuid`,
          afterNId("qr.sort", "qr.id", position),
        )!,
        sql`qr.sort, qr.id`,
        take,
      ),
    keep: (a) => gate(a.question),
    cursorOf: (a) => encodeCursor([String(a.question.sort), a.question.id]),
  });
}

/**
 * The answers of several requests (the export reads a page of requests at a
 * time), grouped by request, each in question order, as far as `actor` may
 * read them.
 */
export async function answersByRequest(
  db: DbOrTx,
  requestIds: string[],
  actor: ActorContext = HR_SCOPE,
): Promise<Map<string, AnswerRow[]>> {
  const grouped = new Map<string, AnswerRow[]>();
  if (requestIds.length === 0) return grouped;
  const rows = await selectAnswers(
    db,
    sql`a.request_id in (${uuidList(requestIds)})`,
    sql`a.request_id, qr.sort, qr.id`,
  );
  const gates = new Map<string, QuestionGate>();
  for (const row of rows) {
    let gate = gates.get(row.requestId);
    if (!gate) {
      gate = await questionGate(db, actor, row.requestId);
      gates.set(row.requestId, gate);
    }
    if (!gate(row.question)) continue;
    const list = grouped.get(row.requestId) ?? [];
    list.push(row);
    grouped.set(row.requestId, list);
  }
  return grouped;
}

// ----------------------------------------------------- question revisions

export type QuestionRevisionRow = {
  id: string;
  cycleId: string;
  /** The template question it was copied from (null once that is deleted). */
  questionId: string | null;
  /** The template group it belongs to; null = the cycle's default template. */
  groupId: string | null;
  sectionTitle: LocalizedText;
  prompt: LocalizedText;
  kind: QuestionKind;
  role: QuestionRole | null;
  appliesTo: Relationship[];
  visibleToReviewee: boolean;
  required: boolean;
  scale: ScaleSnapshot | null;
  choices: { value: string; label: LocalizedText }[] | null;
  sort: number;
  createdAt: string;
};

/**
 * The questions frozen when a cycle launched, in order by (sort, id); null if
 * the cycle is unknown. Revisions never change, so the key is stable.
 */
export async function listQuestionRevisionRows(
  db: DbOrTx,
  cycleId: string,
  { limit, cursor }: { limit: number; cursor?: string | null },
): Promise<Page<QuestionRevisionRow> | null> {
  if (!(await cycleExists(db, cycleId))) return null;
  const rows = rowsOf<QuestionRevisionRow>(
    await db.execute(sql`
      select qr.id, qr.cycle_id as "cycleId", qr.question_id as "questionId",
        qr.group_id as "groupId", qr.section_title as "sectionTitle", qr.prompt,
        qr.kind, qr.role, qr.applies_to as "appliesTo",
        qr.visible_to_reviewee as "visibleToReviewee", qr.required, qr.scale,
        qr.choices, qr.sort, ${iso("qr.created_at")} as "createdAt"
      from question_revision qr
      where ${and(
        sql`qr.cycle_id = ${cycleId}::uuid`,
        afterNId("qr.sort", "qr.id", cursor),
      )!}
      order by qr.sort, qr.id
      limit ${limit + 1}
    `),
  );
  return pageOf(rows, limit, (q) => encodeCursor([String(q.sort), q.id]));
}
