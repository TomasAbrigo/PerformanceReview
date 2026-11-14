import { db } from "@/db/client";
import {
  employmentIdOf,
  ingestFixtureCompany,
  insertJob,
  insertParticipant,
  insertPerson,
  resetAll,
} from "@/modules/analytics/test-support";
import {
  answer,
  questionRevision,
  reviewCycle,
  reviewRequest,
  type QuestionRevision,
} from "@/db/schema";
import type { Relationship } from "@/modules/templates/constants";
import type {
  CycleAnonymity,
  CycleComponents,
  CycleStatus,
} from "@/modules/review-core/status";
import type { RequestStatus } from "@/modules/review-core/request-status";

/**
 * Fixtures for the review API / export DB tests: rows inserted straight into
 * the tables (the review module's own flows are tested in review-core), so a
 * test states exactly the situation it checks.
 */

/** Same shape the review module snapshots at launch. */
export const SCALE = {
  options: [
    { value: 1, normalized: 0, label: { es: "Bajo", en: "Low" } },
    { value: 2, normalized: 1 / 3, label: { es: "Medio", en: "Mid" } },
    { value: 3, normalized: 2 / 3, label: { es: "Alto", en: "High" } },
    { value: 4, normalized: 1, label: { es: "Máximo", en: "Top" } },
  ],
};

export async function insertReviewCycle(r: {
  name: string;
  status?: CycleStatus;
  anonymity?: CycleAnonymity;
  components?: Partial<CycleComponents>;
  deleted?: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(reviewCycle)
    .values({
      name: r.name,
      periodStart: "2025-01-01",
      periodEnd: "2025-06-30",
      snapshotDate: "2025-06-01",
      status: r.status ?? "collecting",
      components: {
        self: true,
        manager: true,
        peer: true,
        upward: true,
        calibration: false,
        ...r.components,
      },
      anonymity: r.anonymity ?? {
        peer: "anonymous_to_employee",
        upward: "fully_anonymous",
      },
      deletedAt: r.deleted ? new Date() : null,
    })
    .returning({ id: reviewCycle.id });
  return row.id;
}

export async function insertQuestion(q: {
  cycleId: string;
  sort: number;
  kind: QuestionRevision["kind"];
  prompt?: { es: string; en: string };
  role?: QuestionRevision["role"];
  visibleToReviewee?: boolean;
  appliesTo?: Relationship[];
  choices?: QuestionRevision["choices"];
}): Promise<string> {
  const [row] = await db
    .insert(questionRevision)
    .values({
      cycleId: q.cycleId,
      sectionTitle: { es: "Sección", en: "Section" },
      prompt: q.prompt ?? {
        es: `Pregunta ${q.sort}`,
        en: `Question ${q.sort}`,
      },
      kind: q.kind,
      appliesTo: q.appliesTo ?? ["self", "manager", "peer", "upward"],
      visibleToReviewee: q.visibleToReviewee ?? true,
      required: false,
      scale: q.kind === "rating" ? SCALE : null,
      choices: q.choices ?? null,
      sort: q.sort,
      role: q.role ?? null,
    })
    .returning({ id: questionRevision.id });
  return row.id;
}

export type NewRequest = {
  cycleId: string;
  participantId: string;
  reviewerPersonId: string | null;
  relationship: Relationship;
  status?: RequestStatus;
  sharedAt?: Date | null;
  deleted?: boolean;
  reviewerMissing?: boolean;
  reviewerMismatch?: boolean;
};

const requestValues = (r: NewRequest) => ({
  cycleId: r.cycleId,
  participantId: r.participantId,
  reviewerPersonId: r.reviewerPersonId,
  relationship: r.relationship,
  status: r.status ?? "submitted",
  submittedAt:
    (r.status ?? "submitted") === "submitted"
      ? new Date("2025-06-20T12:00:00.000Z")
      : null,
  declinedAt:
    r.status === "declined" ? new Date("2025-06-21T12:00:00.000Z") : null,
  sharedAt: r.sharedAt ?? null,
  reviewerMissing: r.reviewerMissing ?? false,
  reviewerMismatch: r.reviewerMismatch ?? false,
  deletedAt: r.deleted ? new Date() : null,
});

export async function insertRequest(r: NewRequest): Promise<string> {
  const [row] = await db
    .insert(reviewRequest)
    .values(requestValues(r))
    .returning({ id: reviewRequest.id });
  return row.id;
}

/** Many requests in ONE statement: identical created_at, so only the id breaks ties. */
export async function insertRequests(rows: NewRequest[]): Promise<string[]> {
  const ids: string[] = [];
  // Chunked: postgres caps the number of bind parameters of one statement.
  for (let i = 0; i < rows.length; i += 500) {
    const inserted = await db
      .insert(reviewRequest)
      .values(rows.slice(i, i + 500).map(requestValues))
      .returning({ id: reviewRequest.id });
    ids.push(...inserted.map((r) => r.id));
  }
  return ids;
}

export type NewAnswer = {
  requestId: string;
  questionRevisionId: string;
  optionValue?: number;
  optionLabel?: string;
  normalized?: number;
  textValue?: string;
};

export async function insertAnswers(rows: NewAnswer[]): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const inserted = await db
      .insert(answer)
      .values(
        rows.slice(i, i + 500).map((a) => ({
          requestId: a.requestId,
          questionRevisionId: a.questionRevisionId,
          optionValue: a.optionValue ?? null,
          optionLabel: a.optionLabel ?? null,
          normalized: a.normalized ?? null,
          textValue: a.textValue ?? null,
        })),
      )
      .returning({ id: answer.id });
    ids.push(...inserted.map((r) => r.id));
  }
  return ids;
}

// --------------------------------------------------------------- scenario

/**
 * The company of the review API tests: Ana (CEO), Bruno (reports to her),
 * Carla (left), Dora (reports to Bruno), peers Eva and Fede and a stranger.
 * One cycle in `sharing` ("Ciclo 360", default anonymity: peer
 * anonymous_to_employee, upward fully_anonymous) with four questions and
 * requests of every kind: Dora's self, manager (shared with her), a
 * submitted and a draft peer one, Bruno's upward and self (draft), the
 * self request of Carla (a removed participant) and a deleted peer request.
 */
export async function seedReviewScenario() {
  await resetAll();
  await resetAll();
  const { ana, bruno, carla } = await ingestFixtureCompany();

  const dora = await insertPerson({
    displayName: "Dora Díaz",
    bambooId: "201",
    employeeNumber: "0201",
  });
  await insertJob({
    personId: dora,
    validFrom: "2024-02-01",
    managerPersonId: bruno,
    employmentId: await employmentIdOf(dora),
    department: "Producto",
    jobTitle: "Designer",
  });
  const eva = await insertPerson({ displayName: "Eva Peña", bambooId: "202" });
  const fede = await insertPerson({
    displayName: "Fede Gómez",
    bambooId: "203",
  });
  const outsider = await insertPerson({
    displayName: "Otto Ajeno",
    bambooId: "204",
  });

  // The 360 cycle: sharing, Dora's manager review is shared with her.
  const cycleId = await insertReviewCycle({
    name: "Ciclo 360",
    status: "sharing",
  });
  const pDora = await insertParticipant({
    cycleId,
    personId: dora,
    snapManagerPersonId: bruno,
    snapDepartment: "Producto",
    snapJobTitle: "Designer",
  });
  const pBruno = await insertParticipant({
    cycleId,
    personId: bruno,
    snapManagerPersonId: ana,
  });
  const pCarla = await insertParticipant({
    cycleId,
    personId: carla,
    snapManagerPersonId: ana,
    removed: true,
  });

  const q1 = await insertQuestion({
    cycleId,
    sort: 0,
    kind: "text",
    prompt: { es: "¿Cómo te fue?", en: "How did it go?" },
  });
  const q2 = await insertQuestion({
    cycleId,
    sort: 1,
    kind: "rating",
    role: "overall_rating",
    appliesTo: ["manager"],
    visibleToReviewee: false,
    prompt: { es: "Rating general", en: "Overall rating" },
  });
  const q3 = await insertQuestion({
    cycleId,
    sort: 2,
    kind: "single_choice",
    appliesTo: ["peer", "upward"],
    choices: [
      { value: "team", label: { es: "Equipo", en: "Team" } },
      { value: "solo", label: { es: "Solo", en: "Solo" } },
    ],
  });
  const q4 = await insertQuestion({
    cycleId,
    sort: 3,
    kind: "text",
    role: "goals_comment",
    appliesTo: ["self", "manager"],
  });

  const selfDora = await insertRequest({
    cycleId,
    participantId: pDora,
    reviewerPersonId: dora,
    relationship: "self",
  });
  const mgrDora = await insertRequest({
    cycleId,
    participantId: pDora,
    reviewerPersonId: bruno,
    relationship: "manager",
    sharedAt: new Date("2025-07-01T09:30:00.123Z"),
  });
  const peerDora = await insertRequest({
    cycleId,
    participantId: pDora,
    reviewerPersonId: eva,
    relationship: "peer",
  });
  const peerDraft = await insertRequest({
    cycleId,
    participantId: pDora,
    reviewerPersonId: fede,
    relationship: "peer",
    status: "draft",
  });
  const upwardBruno = await insertRequest({
    cycleId,
    participantId: pBruno,
    reviewerPersonId: dora,
    relationship: "upward",
  });
  const selfBruno = await insertRequest({
    cycleId,
    participantId: pBruno,
    reviewerPersonId: bruno,
    relationship: "self",
    status: "draft",
  });
  const selfCarla = await insertRequest({
    cycleId,
    participantId: pCarla,
    reviewerPersonId: carla,
    relationship: "self",
  });
  const deletedPeer = await insertRequest({
    cycleId,
    participantId: pDora,
    reviewerPersonId: carla,
    relationship: "peer",
    deleted: true,
  });

  await insertAnswers([
    { requestId: selfDora, questionRevisionId: q1, textValue: "Un buen año" },
    { requestId: selfDora, questionRevisionId: q4, textValue: "Metas ok" },
    { requestId: mgrDora, questionRevisionId: q1, textValue: "Muy bien" },
    {
      requestId: mgrDora,
      questionRevisionId: q2,
      optionValue: 3,
      optionLabel: "Alto",
      normalized: 2 / 3,
    },
    { requestId: mgrDora, questionRevisionId: q4, textValue: "Cumplió" },
    { requestId: peerDora, questionRevisionId: q1, textValue: "Colabora" },
    { requestId: peerDora, questionRevisionId: q3, optionLabel: "team" },
    { requestId: upwardBruno, questionRevisionId: q1, textValue: "Escucha" },
    { requestId: selfCarla, questionRevisionId: q1, textValue: "Me voy" },
    { requestId: deletedPeer, questionRevisionId: q1, textValue: "borrada" },
  ]);

  return {
    ana,
    bruno,
    carla,
    dora,
    eva,
    fede,
    outsider,
    cycleId,
    pDora,
    pBruno,
    pCarla,
    q1,
    q2,
    q3,
    q4,
    selfDora,
    mgrDora,
    peerDora,
    peerDraft,
    upwardBruno,
    selfBruno,
    selfCarla,
    deletedPeer,
  };
}

// ------------------------------------------------------------ http helpers

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export type Route = (
  request: Request,
  context?: { params: Promise<{ id: string }> },
) => Promise<Response>;

/** Calls a route handler like the framework would; the body parsed as JSON. */
export async function call(
  route: Route,
  path: string,
  id?: string,
  headers?: HeadersInit,
) {
  const response = await route(
    new Request(`http://localhost${path}`, { headers }),
    id === undefined ? undefined : { params: Promise.resolve({ id }) },
  );
  return {
    status: response.status,
    type: response.headers.get("content-type") ?? "",
    body: (await response.json()) as Json,
  };
}

/** Walks a list endpoint page by page, returning every id in order. */
export async function walk(
  route: Route,
  path: string,
  id: string | undefined,
  limit: number,
  from: string | null = null,
) {
  const sep = path.includes("?") ? "&" : "?";
  const ids: string[] = [];
  let cursor: string | null = from;
  for (let guard = 0; guard < 100; guard++) {
    const res = await call(
      route,
      `${path}${sep}limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`,
      id,
    );
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
    ids.push(...res.body.data.map((r: Json) => r.id));
    cursor = res.body.next_cursor;
    if (!cursor) return ids;
  }
  throw new Error("pagination did not terminate");
}
