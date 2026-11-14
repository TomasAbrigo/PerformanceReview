import { z } from "zod";
import { db } from "@/db/client";
import { identityIssueStatuses } from "@/db/schema";
import { exportCsv } from "@/modules/exports/entities";
import { RUN_STATUSES } from "@/modules/ingest/run-status";
import { requestStatuses } from "@/modules/review-core/request-status";
import { relationships } from "@/modules/templates/constants";
import { todayLocal } from "@/modules/org-history/dates";
import { notFound } from "./errors";
import { apiRoute, ok, parseQuery } from "./http";
import { bool, isoDate, uuid } from "./params";
import { decodeCursor, pageParams, type Page } from "./pagination";
import { getCycleDetail, listCycleRows } from "./queries/cycles";
import { goalStatuses, listGoalRows } from "./queries/goals";
import { listIssueRows } from "./queries/issues";
import { listOrgAsOf } from "./queries/org";
import {
  getPersonDetail,
  listPeopleRows,
  personExists,
} from "./queries/people";
import {
  cycleExists,
  getRequestRow,
  listAnswerRows,
  listQuestionRevisionRows,
  listRequestRows,
} from "./queries/reviews";
import { getRunDetail, listRunRows } from "./queries/runs";
import { checkScope, scopeActor, scopeFields, scopeQuery } from "./scope";
import {
  serializeAnswer,
  serializeCycle,
  serializeCycleDetail,
  serializeGoal,
  serializeIssue,
  serializeOrgRow,
  serializePerson,
  serializePersonDetail,
  serializeQuestionRevision,
  serializeRequest,
  serializeRequestDetail,
  serializeRun,
  serializeRunDetail,
} from "./serializers";

/**
 * Route handlers of the read-only JSON API (`/api/v1`). Each one is a plain
 * `(Request, context) => Promise<Response>`: the files under `src/app/api/v1`
 * only re-export them, and tests call them directly. Lists answer
 * `{ data, next_cursor }`, details `{ data }`, errors problem+json.
 */

const envelope = <T, U>(page: Page<T>, serialize: (row: T) => U) => ({
  data: page.items.map(serialize),
  next_cursor: page.nextCursor,
});

const detailOr404 = async <T>(
  what: string,
  load: () => Promise<T | null>,
): Promise<T> => {
  const row = await load();
  if (!row) throw notFound(what);
  return row;
};

// ---------------------------------------------------------------- people

const peopleQuery = pageParams.extend({
  q: z.string().max(200).optional(),
  active: bool.optional(),
});

export const listPeopleRoute = apiRoute(async (request) => {
  const query = parseQuery(request, peopleQuery);
  return ok(envelope(await listPeopleRows(db, query), serializePerson));
});

export const getPersonRoute = apiRoute<{ id: string }>(
  async (_request, { id }) => {
    const person = await detailOr404("Person", () => getPersonDetail(db, id));
    return ok({ data: serializePersonDetail(person) });
  },
);

// ------------------------------------------------------------------- org

const orgQuery = pageParams.extend({ date: isoDate.optional() });

export const orgAsOfRoute = apiRoute(async (request) => {
  const { date = todayLocal(), ...page } = parseQuery(request, orgQuery);
  return ok({
    as_of: date,
    ...envelope(await listOrgAsOf(db, { date, ...page }), serializeOrgRow),
  });
});

// ----------------------------------------------------------------- goals

const goalsQuery = pageParams.extend({
  person_id: uuid.optional(),
  manager_id: uuid.optional(),
  status: z.enum(goalStatuses).optional(),
});

export const listGoalsRoute = apiRoute(async (request) => {
  const { person_id, manager_id, ...query } = parseQuery(request, goalsQuery);
  const page = await listGoalRows(db, {
    ...query,
    personId: person_id,
    managerId: manager_id,
  });
  return ok(envelope(page, serializeGoal));
});

export const personGoalsRoute = apiRoute<{ id: string }>(
  async (request, { id }) => {
    const query = parseQuery(
      request,
      pageParams.extend({ status: z.enum(goalStatuses).optional() }),
    );
    if (!(await personExists(db, id))) throw notFound("Person");
    const page = await listGoalRows(db, { ...query, personId: id });
    return ok(envelope(page, serializeGoal));
  },
);

// ---------------------------------------------------------------- cycles

export const listCyclesRoute = apiRoute(async (request) => {
  const query = parseQuery(request, pageParams);
  return ok(envelope(await listCycleRows(db, query), serializeCycle));
});

export const getCycleRoute = apiRoute<{ id: string }>(
  async (_request, { id }) => {
    const cycle = await detailOr404("Cycle", () => getCycleDetail(db, id));
    return ok({ data: serializeCycleDetail(cycle) });
  },
);

// ----------------------------------------------------------- ingest runs

const runsQuery = pageParams.extend({
  source: z.string().max(50).optional(),
  entity: z.string().max(50).optional(),
  status: z.enum(RUN_STATUSES).optional(),
});

export const listRunsRoute = apiRoute(async (request) => {
  const query = parseQuery(request, runsQuery);
  return ok(envelope(await listRunRows(db, query), serializeRun));
});

export const getRunRoute = apiRoute<{ id: string }>(
  async (_request, { id }) => {
    const run = await detailOr404("Ingest run", () => getRunDetail(db, id));
    return ok({ data: serializeRunDetail(run) });
  },
);

// -------------------------------------------------------- identity issues

const issuesQuery = pageParams.extend({
  status: z.enum(identityIssueStatuses).optional(),
});

export const listIdentityIssuesRoute = apiRoute(async (request) => {
  const query = parseQuery(request, issuesQuery);
  return ok(envelope(await listIssueRows(db, query), serializeIssue));
});

// ------------------------------------------------- review requests, answers

/**
 * Review data is read as HR by default (the API is an integration surface:
 * see scope.ts) and, with `?as_person=&role=`, as a person (canRead).
 * Peer/upward reviewers under `fully_anonymous` are never exposed.
 */
export const requestsQuery = pageParams
  .extend({
    relationship: z.enum(relationships).optional(),
    status: z.enum(requestStatuses).optional(),
    participant_id: uuid.optional(),
    ...scopeFields,
  })
  .superRefine(checkScope);

export const listCycleRequestsRoute = apiRoute<{ id: string }>(
  async (request, { id }) => {
    const { participant_id, scope, as_person, role, ...query } = parseQuery(
      request,
      requestsQuery,
    );
    // The cursor first: a bad one is a 400 whatever else is wrong.
    decodeCursor(query.cursor, "ts_id");
    const [exists, actor] = await Promise.all([
      cycleExists(db, id),
      scopeActor(db, { scope, as_person, role }),
    ]);
    if (!exists) throw notFound("Cycle");
    const page = await listRequestRows(db, {
      ...query,
      cycleId: id,
      participantId: participant_id,
      actor,
    });
    return ok(envelope(page, serializeRequest));
  },
);

export const getRequestRoute = apiRoute<{ id: string }>(
  async (request, { id }) => {
    const scope = parseQuery(request, scopeQuery);
    const actor = await scopeActor(db, scope);
    const row = await detailOr404("Request", () =>
      getRequestRow(db, id, actor),
    );
    return ok({ data: serializeRequestDetail(row) });
  },
);

const answersQuery = pageParams.extend(scopeFields).superRefine(checkScope);

export const listRequestAnswersRoute = apiRoute<{ id: string }>(
  async (request, { id }) => {
    const { scope, as_person, role, ...query } = parseQuery(
      request,
      answersQuery,
    );
    decodeCursor(query.cursor, "n_id");
    const actor = await scopeActor(db, { scope, as_person, role });
    const page = await detailOr404("Request", () =>
      listAnswerRows(db, id, { ...query, actor }),
    );
    return ok(envelope(page, serializeAnswer));
  },
);

export const listQuestionRevisionsRoute = apiRoute<{ id: string }>(
  async (request, { id }) => {
    const query = parseQuery(request, pageParams);
    const page = await detailOr404("Cycle", () =>
      listQuestionRevisionRows(db, id, query),
    );
    return ok(envelope(page, serializeQuestionRevision));
  },
);

// --------------------------------------------------------------- exports

/** `/api/v1/export/<entity>.csv`: see `modules/exports`. */
export const exportRoute = apiRoute<{ entity: string }>(
  async (request, { entity }) => exportCsv(db, entity, request),
);
