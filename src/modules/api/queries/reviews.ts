import { and, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { LocalizedText, ScaleSnapshot } from "@/db/schema";
import { rowsOf } from "@/lib/sql";
import { isUuid } from "@/lib/uuid";
import { DEFAULT_ACTOR, type ActorContext } from "@/modules/actor/types";
import type { FinalRatingStage } from "@/modules/review-core/rating-constants";
import type { RequestStatus } from "@/modules/review-core/request-status";
import {
  visibilityContexts,
  type VisibilityRow,
} from "@/modules/review-core/requests";
import type {
  CycleAnonymity,
  CycleComponents,
  CycleStatus,
} from "@/modules/review-core/status";
import {
  canRead,
  reviewerVisible,
  type VisibilityContext,
} from "@/modules/review-core/visibility";
import type {
  QuestionKind,
  QuestionRole,
  Relationship,
} from "@/modules/templates/constants";
import { forbidden } from "../errors";
import { decodeCursor, encodeCursor, pageOf, type Page } from "../pagination";
import {
  afterNId,
  afterTsId,
  identityCtes,
  iso,
  personRef,
  uuidList,
  type PersonRef,
} from "./shared";

/**
 * Review requests, their answers and the frozen questions, for the JSON API
 * and the answers/requests CSV exports.
 *
 * Reading as: the API has no actor, so every function takes the `actor` it
 * reads as. The default is HR (everything, see `scope.ts`); any other actor
 * is filtered through `canRead` of the review module, the one place that
 * decides who reads what. A page costs a fixed number of queries: the rows,
 * then the extras `canRead` needs for the whole page (`visibilityContexts`),
 * and every row keeps the context it was decided with (`visibility`) so its
 * answers are gated without asking again.
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

/**
 * A page of the rows `actor` may read. The keyset runs over the rows as
 * stored; `keep` picks the readable ones of each batch (all at once, so the
 * extras it needs are queried per batch, not per row). A page is full (up to
 * `limit`) whenever there are enough readable rows after the cursor, and the
 * cursor is the key of the last row returned, so the next page resumes right
 * after it. HR reads every row: one batch.
 */
async function readablePage<Scanned, Item>(input: {
  limit: number;
  cursor: string | null | undefined;
  fetch: (cursor: string | null, take: number) => Promise<Scanned[]>;
  keep: (batch: Scanned[]) => Promise<Item[]> | Item[];
  scannedCursor: (row: Scanned) => string;
  itemCursor: (item: Item) => string;
}): Promise<Page<Item>> {
  const { limit, fetch, keep } = input;
  const kept: Item[] = [];
  let cursor = input.cursor ?? null;
  for (;;) {
    const batch = await fetch(cursor, limit + 1);
    kept.push(...(await keep(batch)));
    const last = batch.at(-1);
    if (kept.length > limit || batch.length <= limit || !last) break;
    cursor = input.scannedCursor(last);
  }
  return pageOf(kept, limit, input.itemCursor);
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
  requestedAt: string;
  submittedAt: string | null;
  declinedAt: string | null;
  /** Manager reviews: when it was shared with the reviewee. */
  sharedAt: string | null;
  /** The answers the actor may read (the reviewee does not count the ones hidden from them). */
  answerCount: number;
  createdAt: string;
  updatedAt: string;
  /**
   * What canRead decided this row with, for the actor that read it (internal:
   * gates the answers per question, never serialized; it holds the raw
   * reviewer id, anonymity or not).
   */
  visibility: VisibilityContext;
};

type RawRequest = Omit<
  RequestRow,
  | "reviewee"
  | "snapManager"
  | "reviewer"
  | "reviewerVisible"
  | "currentRating"
  | "answerCount"
  | "visibility"
> & {
  cycleComponents: CycleComponents;
  /** Answers of the request, and those of questions the reviewee may see. */
  answerTotal: number;
  answerShown: number;
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

/** What canRead reads, from a selected row. */
const visibilityRowOf = (raw: RawRequest): VisibilityRow => ({
  request: {
    relationship: raw.relationship,
    reviewerPersonId: raw.reviewerId,
    status: raw.status,
    sharedAt: raw.sharedAt ? new Date(raw.sharedAt) : null,
  },
  participant: {
    id: raw.participantId,
    revieweePersonId: raw.revieweeId,
    snapManagerPersonId: raw.managerId,
    snapshotAsOf: raw.snapshotAsOf,
    removedAt: raw.participantRemovedAt
      ? new Date(raw.participantRemovedAt)
      : null,
  },
  cycle: {
    status: raw.cycleStatus,
    components: raw.cycleComponents,
    anonymity: raw.cycleAnonymity,
  },
});

function toRequestRow(
  raw: RawRequest,
  actor: ActorContext,
  visibility: VisibilityContext,
): RequestRow {
  const {
    // Only canRead reads the components (see visibilityRowOf).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    cycleComponents: _cycleComponents,
    answerTotal,
    answerShown,
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
  // The API never tells a fully anonymous reviewer, not even their author.
  const shown = reviewerVisible(actor, visibility, { hideFromAuthor: true });
  const reads = (visibleToReviewee: boolean) =>
    canRead(actor, { ...visibility, questionRevision: { visibleToReviewee } });
  return {
    ...row,
    answerCount:
      (reads(true) ? answerShown : 0) +
      (reads(false) ? answerTotal - answerShown : 0),
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
    visibility,
  };
}

async function selectRequests(
  db: DbOrTx,
  where: SQL,
  limit: number,
): Promise<RawRequest[]> {
  return rowsOf<RawRequest>(
    await db.execute(sql`
      with ${identityCtes}
      select r.id, r.source_system::text as "sourceSystem", r.source_id as "sourceId",
        r.cycle_id as "cycleId", c.source_system::text as "cycleSourceSystem",
        c.source_id as "cycleSourceId", c.name as "cycleName",
        c.status::text as "cycleStatus", c.anonymity as "cycleAnonymity",
        c.components as "cycleComponents",
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
        ${iso("r.requested_at")} as "requestedAt",
        ${iso("r.submitted_at")} as "submittedAt",
        ${iso("r.declined_at")} as "declinedAt",
        ${iso("r.shared_at")} as "sharedAt",
        cr.stage::text as "ratingStage", cr.option_value::float8 as "ratingValue",
        cr.option_label as "ratingLabel", cr.normalized::float8 as "ratingNormalized",
        ${iso("cr.created_at")} as "ratingAt",
        ac.total as "answerTotal", ac.shown as "answerShown",
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
      cross join lateral (
        select count(*)::int as total,
          (count(*) filter (where qr.visible_to_reviewee))::int as shown
        from answer a
        join question_revision qr on qr.id = a.question_revision_id
        where a.request_id = r.id
      ) ac
      where r.deleted_at is null and ${where}
      order by r.created_at, r.id
      limit ${limit}
    `),
  );
}

/** The rows `actor` may read, with the context each was decided with (one set of extra queries for all). */
async function readableRequests(
  db: DbOrTx,
  actor: ActorContext,
  raws: RawRequest[],
): Promise<RequestRow[]> {
  const contexts = await visibilityContexts(
    db,
    actor,
    raws.map(visibilityRowOf),
  );
  return raws.flatMap((raw, i) =>
    canRead(actor, contexts[i]) ? [toRequestRow(raw, actor, contexts[i])] : [],
  );
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
  // A cursor that is not ours is a 400 whatever else is wrong with the query.
  decodeCursor(cursor, "ts_id");
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
      ),
    keep: (batch) => readableRequests(db, actor, batch),
    scannedCursor: (r) => encodeCursor([r.createdAt, r.id]),
    itemCursor: (r) => encodeCursor([r.createdAt, r.id]),
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
  const [raw] = await selectRequests(db, sql`r.id = ${id}::uuid`, 1);
  if (!raw) return null;
  const [visibility] = await visibilityContexts(db, actor, [
    visibilityRowOf(raw),
  ]);
  if (!canRead(actor, visibility)) {
    throw forbidden("The person cannot read this request.");
  }
  return toRequestRow(raw, actor, visibility);
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

/** Whether `actor` may read the answer to `question` of an already read request (canRead per question). */
const readsAnswer = (
  actor: ActorContext,
  request: RequestRow,
  question: AnswerRow["question"],
) => canRead(actor, { ...request.visibility, questionRevision: question });

/**
 * The answers of one request in question order (sort, revision id), as far as
 * `actor` may read them (the reviewee does not get the questions hidden from
 * them); null if the request is unknown (or deleted). Throws a 403 when the
 * actor may not read the request.
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
  decodeCursor(cursor, "n_id");
  const request = await getRequestRow(db, requestId, actor);
  if (!request) return null;
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
    keep: (batch) =>
      batch.filter((a) => readsAnswer(actor, request, a.question)),
    scannedCursor: (a) =>
      encodeCursor([String(a.question.sort), a.question.id]),
    itemCursor: (a) => encodeCursor([String(a.question.sort), a.question.id]),
  });
}

/**
 * The answers of several requests already read as `actor` (the export reads
 * a page of requests at a time), grouped by request, each in question order,
 * as far as `actor` may read them. One query, whoever reads.
 */
export async function answersByRequest(
  db: DbOrTx,
  requests: RequestRow[],
  actor: ActorContext = HR_SCOPE,
): Promise<Map<string, AnswerRow[]>> {
  const grouped = new Map<string, AnswerRow[]>();
  if (requests.length === 0) return grouped;
  const byId = new Map(requests.map((r) => [r.id, r]));
  const rows = await selectAnswers(
    db,
    sql`a.request_id in (${uuidList([...byId.keys()])})`,
    sql`a.request_id, qr.sort, qr.id`,
  );
  for (const row of rows) {
    const request = byId.get(row.requestId);
    if (!request || !readsAnswer(actor, request, row.question)) continue;
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
  decodeCursor(cursor, "n_id");
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
