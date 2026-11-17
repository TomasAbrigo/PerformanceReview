import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db, closeDb } from "@/db/client";
import { person, reviewRequest } from "@/db/schema";
import { eq } from "drizzle-orm";
import { insertParticipant, resetAll } from "@/modules/analytics/test-support";
import type { ActorContext } from "@/modules/actor/types";
import { getReview } from "@/modules/review-core";
import { currentRatingFor } from "@/modules/review-core/rating";
import { ApiError } from "./errors";
import { scopeActor } from "./scope";
import { listAnswerRows, listRequestRows } from "./queries/reviews";
import type { CycleAnonymity } from "@/modules/review-core/status";
import {
  getRequestRoute,
  listCycleRequestsRoute,
  listQuestionRevisionsRoute,
  listRequestAnswersRoute,
} from "./handlers";
import {
  call,
  insertAnswers,
  insertQuestion,
  insertRequest,
  insertRequests,
  insertReviewCycle,
  seedReviewScenario,
  walk,
  type Json,
} from "./review-test-support";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/;
const MISSING = "00000000-0000-4000-8000-000000000000";

let ana: string;
let bruno: string;
let carla: string;
let dora: string;
let eva: string;
let fede: string;
let outsider: string;

let cycleId: string;
let pDora: string;
let pBruno: string;
let q1: string;
let q2: string;
let q3: string;
let q4: string;
let selfDora: string;
let mgrDora: string;
let peerDora: string;
let peerDraft: string;
let upwardBruno: string;
let selfBruno: string;
let selfCarla: string;
let deletedPeer: string;

const requestsOf = (id: string, query = "") =>
  call(listCycleRequestsRoute, `/api/v1/cycles/${id}/requests${query}`, id);
const requestOf = (id: string, query = "") =>
  call(getRequestRoute, `/api/v1/requests/${id}${query}`, id);
const answersOf = (id: string, query = "") =>
  call(listRequestAnswersRoute, `/api/v1/requests/${id}/answers${query}`, id);

/** One cycle per anonymity mode, each with a submitted peer and upward request on Dora. */
async function anonymityCycle(anonymity: CycleAnonymity) {
  const cycle = await insertReviewCycle({
    name: `Anon ${anonymity.peer}/${anonymity.upward}`,
    status: "sharing",
    anonymity,
    components: { manager: false },
  });
  const participant = await insertParticipant({
    cycleId: cycle,
    personId: dora,
    snapManagerPersonId: bruno,
  });
  const q = await insertQuestion({ cycleId: cycle, sort: 0, kind: "text" });
  const peer = await insertRequest({
    cycleId: cycle,
    participantId: participant,
    reviewerPersonId: eva,
    relationship: "peer",
  });
  const upward = await insertRequest({
    cycleId: cycle,
    participantId: participant,
    reviewerPersonId: fede,
    relationship: "upward",
  });
  await insertAnswers([
    { requestId: peer, questionRevisionId: q, textValue: "de un par" },
    { requestId: upward, questionRevisionId: q, textValue: "de un reporte" },
  ]);
  return { cycle, peer, upward };
}

beforeAll(async () => {
  ({
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
  } = await seedReviewScenario());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await resetAll();
  await closeDb();
});

describe("GET /api/v1/cycles/{id}/requests", () => {
  it("lists the cycle's requests with ids, sources, people, snapshot and timestamps", async () => {
    const res = await requestsOf(cycleId, "?limit=200");
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/^application\/json/);
    expect(res.body.next_cursor).toBeNull();
    const ids = res.body.data.map((r: Json) => r.id);
    expect(ids.sort()).toEqual(
      [
        selfDora,
        mgrDora,
        peerDora,
        peerDraft,
        upwardBruno,
        selfBruno,
        selfCarla,
      ].sort(),
    );
    expect(ids).not.toContain(deletedPeer);

    const mgr = res.body.data.find((r: Json) => r.id === mgrDora);
    expect(mgr).toMatchObject({
      id: mgrDora,
      source: null,
      cycle_id: cycleId,
      relationship: "manager",
      status: "submitted",
      participant: {
        id: pDora,
        removed_at: null,
        snapshot: {
          as_of: "2025-06-01",
          manager: {
            id: bruno,
            source: { system: "bamboo_api", id: "102" },
            display_name: "Bruno Pérez",
          },
          department: "Producto",
          job_title: "Designer",
        },
      },
      reviewee: {
        id: dora,
        source: { system: "bamboo_api", id: "201" },
        display_name: "Dora Díaz",
      },
      reviewer: {
        id: bruno,
        source: { system: "bamboo_api", id: "102" },
        display_name: "Bruno Pérez",
      },
      reviewer_visible: true,
      reviewer_missing: false,
      reviewer_mismatch: false,
      declined_at: null,
      answer_count: 3,
    });
    expect(mgr.shared_at).toBe("2025-07-01T09:30:00.123000Z");
    expect(mgr.submitted_at).toMatch(ISO);
    expect(mgr.requested_at).toMatch(ISO);
    expect(mgr.created_at).toMatch(ISO);
    expect(mgr.updated_at).toMatch(ISO);
    expect(mgr.id).toMatch(UUID);

    const draft = res.body.data.find((r: Json) => r.id === peerDraft);
    expect(draft).toMatchObject({
      status: "draft",
      submitted_at: null,
      shared_at: null,
      answer_count: 0,
    });
  });

  it("lists the requests of removed participants, flagged on the participant", async () => {
    const res = await requestsOf(cycleId, "?limit=200");
    const row = res.body.data.find((r: Json) => r.id === selfCarla);
    expect(row.participant.removed_at).toMatch(ISO);
  });

  it("filters by relationship, status and participant_id (and combines them)", async () => {
    const peers = await requestsOf(cycleId, "?relationship=peer&limit=200");
    expect(peers.body.data.map((r: Json) => r.id).sort()).toEqual(
      [peerDora, peerDraft].sort(),
    );
    const drafts = await requestsOf(cycleId, "?status=draft&limit=200");
    expect(drafts.body.data.map((r: Json) => r.id).sort()).toEqual(
      [peerDraft, selfBruno].sort(),
    );
    const ofBruno = await requestsOf(cycleId, `?participant_id=${pBruno}`);
    expect(ofBruno.body.data.map((r: Json) => r.id).sort()).toEqual(
      [selfBruno, upwardBruno].sort(),
    );
    const combined = await requestsOf(
      cycleId,
      `?participant_id=${pDora}&relationship=peer&status=submitted`,
    );
    expect(combined.body.data.map((r: Json) => r.id)).toEqual([peerDora]);
    const none = await requestsOf(cycleId, `?participant_id=${MISSING}`);
    expect(none.body).toEqual({ data: [], next_cursor: null });
  });

  it.each([
    ["relationship=boss", "relationship"],
    ["status=late", "status"],
    ["participant_id=nope", "participant_id"],
    ["limit=0", "limit"],
    ["cursor=garbage", "cursor"],
  ])("answers 400 problem+json for %s", async (query, field) => {
    const res = await requestsOf(cycleId, `?${query}`);
    expect(res.status).toBe(400);
    expect(res.type).toBe("application/problem+json");
    expect(res.body.errors.map((e: Json) => e.path)).toContain(field);
  });

  it("answers 404 for an unknown, malformed or deleted cycle", async () => {
    const deleted = await insertReviewCycle({ name: "Borrado", deleted: true });
    for (const id of [MISSING, "not-a-uuid", deleted]) {
      const res = await requestsOf(id);
      expect(res.status).toBe(404);
      expect(res.type).toBe("application/problem+json");
      expect(res.body).toMatchObject({ status: 404, title: "Not Found" });
    }
  });

  it("only lists the requests of that cycle", async () => {
    const other = await insertReviewCycle({ name: "Otro ciclo" });
    const participant = await insertParticipant({
      cycleId: other,
      personId: ana,
    });
    const own = await insertRequest({
      cycleId: other,
      participantId: participant,
      reviewerPersonId: ana,
      relationship: "self",
    });
    const res = await requestsOf(other);
    expect(res.body.data.map((r: Json) => r.id)).toEqual([own]);
  });

  describe("keyset pagination", () => {
    let big: string;
    let ids: string[];

    beforeAll(async () => {
      big = await insertReviewCycle({ name: "Ciclo grande" });
      const participant = await insertParticipant({
        cycleId: big,
        personId: dora,
        snapManagerPersonId: bruno,
      });
      const reviewers = await db
        .insert(person)
        .values([1, 2, 3, 4, 5, 6, 7].map((n) => ({ displayName: `Par ${n}` })))
        .returning({ id: person.id });
      // ONE statement: identical created_at, so only the id breaks ties.
      ids = await insertRequests(
        reviewers.map((r) => ({
          cycleId: big,
          participantId: participant,
          reviewerPersonId: r.id,
          relationship: "peer" as const,
        })),
      );
    });

    it("pages every request exactly once, in the order of one big page", async () => {
      const all = await requestsOf(big, "?limit=200");
      const expected = all.body.data.map((r: Json) => r.id);
      expect(expected.sort()).toEqual([...ids].sort());
      const sorted = all.body.data.map((r: Json) => r.id);
      for (const limit of [1, 2, 3, 7]) {
        expect(
          await walk(
            listCycleRequestsRoute,
            `/api/v1/cycles/${big}/requests`,
            big,
            limit,
          ),
        ).toEqual(sorted);
      }
    });

    it("gives next_cursor only while there is more", async () => {
      expect((await requestsOf(big, "?limit=7")).body.next_cursor).toBeNull();
      expect(typeof (await requestsOf(big, "?limit=6")).body.next_cursor).toBe(
        "string",
      );
    });

    it("keeps the next pages stable when a request arrives meanwhile", async () => {
      const first = await requestsOf(big, "?limit=3");
      const [late] = await db
        .insert(person)
        .values({ displayName: "Llegada tarde" })
        .returning({ id: person.id });
      const [participant] = (await requestsOf(big, "?limit=1")).body.data.map(
        (r: Json) => r.participant.id,
      );
      const lateRequest = await insertRequest({
        cycleId: big,
        participantId: participant,
        reviewerPersonId: late.id,
        relationship: "peer",
      });
      try {
        const rest = await walk(
          listCycleRequestsRoute,
          `/api/v1/cycles/${big}/requests`,
          big,
          2,
          first.body.next_cursor,
        );
        const seen = [...first.body.data.map((r: Json) => r.id), ...rest];
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen).toContain(lateRequest);
        expect(seen.slice(0, 3)).toEqual(
          first.body.data.map((r: Json) => r.id),
        );
      } finally {
        await db.delete(reviewRequest).where(eq(reviewRequest.id, lateRequest));
        await db.delete(person).where(eq(person.id, late.id));
      }
    });
  });

  it("requires the bearer token when API_TOKEN is set", async () => {
    vi.stubEnv("API_TOKEN", "s3cret");
    const denied = await requestsOf(cycleId);
    expect(denied.status).toBe(401);
    expect(denied.type).toBe("application/problem+json");
    const allowed = await call(
      listCycleRequestsRoute,
      `/api/v1/cycles/${cycleId}/requests`,
      cycleId,
      { Authorization: "Bearer s3cret" },
    );
    expect(allowed.status).toBe(200);
  });
});

describe("current rating", () => {
  it("rides on the participant of every request, as the calibration module reads it (hr scope)", async () => {
    const expected = await currentRatingFor(db, pDora);
    expect(expected).toMatchObject({ stage: "calibrated", optionValue: 4 });
    const res = await requestsOf(cycleId, `?participant_id=${pDora}&limit=200`);
    expect(res.body.data.length).toBeGreaterThan(1);
    for (const row of res.body.data) {
      expect(row.participant.current_rating).toMatchObject({
        stage: "calibrated",
        option_value: 4,
        option_label: "Máximo",
        normalized: 1,
      });
      expect(row.participant.current_rating.created_at).toMatch(ISO);
    }
    const detail = await requestOf(mgrDora);
    expect(detail.body.data.participant.current_rating.option_value).toBe(
      expected!.optionValue,
    );
  });

  it("is null when the participant has no rating", async () => {
    const res = await requestOf(upwardBruno);
    expect(res.body.data.participant.current_rating).toBeNull();
  });

  it("is withheld from everybody but HR: not the reviewee, not the manager", async () => {
    for (const as of [
      `as_person=${dora}&role=employee`,
      `as_person=${bruno}&role=manager`,
    ]) {
      const res = await requestOf(mgrDora, `?${as}`);
      expect(res.status, as).toBe(200);
      expect(res.body.data.participant.current_rating, as).toBeNull();
    }
    const asHr = await requestOf(mgrDora, `?as_person=${ana}&role=hr`);
    expect(asHr.body.data.participant.current_rating).not.toBeNull();
  });
});

describe("superseded manager requests (history data)", () => {
  it("are listed with their status and can be filtered", async () => {
    const cycle = await insertReviewCycle({ name: "Assessors" });
    const participant = await insertParticipant({
      cycleId: cycle,
      personId: dora,
      snapManagerPersonId: bruno,
    });
    const superseded = await insertRequest({
      cycleId: cycle,
      participantId: participant,
      reviewerPersonId: bruno,
      relationship: "manager",
      status: "superseded",
    });
    const current = await insertRequest({
      cycleId: cycle,
      participantId: participant,
      reviewerPersonId: ana,
      relationship: "manager",
    });
    const res = await requestsOf(cycle, "?relationship=manager");
    expect(res.body.data).toHaveLength(2);
    const byId = new Map(res.body.data.map((r: Json) => [r.id, r]));
    expect(byId.get(superseded)).toMatchObject({
      status: "superseded",
      reviewer: { id: bruno },
    });
    expect(byId.get(current)).toMatchObject({
      status: "submitted",
      reviewer: { id: ana },
    });
    const history = await requestsOf(cycle, "?status=superseded");
    expect(history.body.data.map((r: Json) => r.id)).toEqual([superseded]);
  });
});

describe("reviewer anonymity", () => {
  it("transparent: peer and upward reviewers are named", async () => {
    const { cycle, peer, upward } = await anonymityCycle({
      peer: "transparent",
      upward: "transparent",
    });
    const res = await requestsOf(cycle);
    const byId = new Map(res.body.data.map((r: Json) => [r.id, r]));
    expect(byId.get(peer)).toMatchObject({
      reviewer: { id: eva, display_name: "Eva Peña" },
      reviewer_visible: true,
    });
    expect(byId.get(upward)).toMatchObject({
      reviewer: { id: fede },
      reviewer_visible: true,
    });
  });

  it("anonymous_to_employee: the hr scope names the reviewer, the reviewee's view does not", async () => {
    const { cycle, peer } = await anonymityCycle({
      peer: "anonymous_to_employee",
      upward: "anonymous_to_employee",
    });
    const hr = await requestOf(peer);
    expect(hr.body.data).toMatchObject({
      reviewer: { id: eva },
      reviewer_visible: true,
    });
    const explicitHr = await requestOf(peer, "?scope=hr");
    expect(explicitHr.body.data.reviewer.id).toBe(eva);

    const asReviewee = await requestOf(peer, `?as_person=${dora}`);
    expect(asReviewee.status).toBe(200);
    expect(asReviewee.body.data).toMatchObject({
      reviewer: null,
      reviewer_visible: false,
    });
    const listed = await requestsOf(cycle, `?as_person=${dora}`);
    expect(listed.body.data).toHaveLength(2);
    for (const row of listed.body.data) {
      expect(row).toMatchObject({ reviewer: null, reviewer_visible: false });
    }
    // The reviewee's manager is not the reviewee: they may know who wrote it.
    const asManager = await requestOf(peer, `?as_person=${bruno}&role=manager`);
    expect(asManager.body.data.reviewer.id).toBe(eva);
  });

  it("fully_anonymous: nobody gets the reviewer, whatever the scope", async () => {
    const { cycle, peer, upward } = await anonymityCycle({
      peer: "fully_anonymous",
      upward: "fully_anonymous",
    });
    const scopes = [
      "",
      "?scope=hr",
      `?as_person=${ana}&role=hr`,
      `?as_person=${bruno}&role=manager`,
    ];
    for (const scope of scopes) {
      for (const id of [peer, upward]) {
        const res = await requestOf(id, scope);
        expect(res.status, scope).toBe(200);
        expect(res.body.data.reviewer, scope).toBeNull();
        expect(res.body.data.reviewer_visible, scope).toBe(false);
      }
      const listed = await requestsOf(cycle, scope);
      for (const row of listed.body.data) {
        expect(row.reviewer, scope).toBeNull();
        expect(row.reviewer_visible, scope).toBe(false);
      }
    }
    // Not even its own author gets it back from the API.
    for (const [id, author] of [
      [peer, eva],
      [upward, fede],
    ]) {
      const res = await requestOf(id, `?as_person=${author}&role=employee`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        reviewer: null,
        reviewer_visible: false,
      });
    }
    // Nothing of the reviewer anywhere in the payload.
    const raw = JSON.stringify([
      (await requestOf(peer)).body,
      (await requestOf(upward)).body,
      (await requestsOf(cycle)).body,
      (await answersOf(peer)).body,
    ]);
    for (const secret of [eva, fede, "Eva Peña", "Fede Gómez"]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("self and manager requests always name their reviewer", async () => {
    const res = await requestsOf(cycleId, "?relationship=manager");
    expect(res.body.data[0]).toMatchObject({
      reviewer: { id: bruno },
      reviewer_visible: true,
    });
  });

  it("a manager request without reviewer has reviewer null but is not anonymous", async () => {
    const cycle = await insertReviewCycle({ name: "Sin manager" });
    const participant = await insertParticipant({
      cycleId: cycle,
      personId: ana,
    });
    const request = await insertRequest({
      cycleId: cycle,
      participantId: participant,
      reviewerPersonId: null,
      relationship: "manager",
      status: "draft",
      reviewerMissing: true,
    });
    const res = await requestOf(request);
    expect(res.body.data).toMatchObject({
      reviewer: null,
      reviewer_visible: true,
      reviewer_missing: true,
    });
  });
});

describe("GET /api/v1/requests/{id}", () => {
  it("returns the request with cycle, participant snapshot, both people and shared_at", async () => {
    const res = await requestOf(mgrDora);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: mgrDora,
      cycle_id: cycleId,
      cycle: {
        id: cycleId,
        source: null,
        name: "Ciclo 360",
        status: "sharing",
        anonymity: { peer: "anonymous_to_employee", upward: "fully_anonymous" },
      },
      relationship: "manager",
      participant: {
        id: pDora,
        snapshot: {
          as_of: "2025-06-01",
          manager: { id: bruno },
          department: "Producto",
        },
      },
      reviewee: { id: dora, source: { system: "bamboo_api", id: "201" } },
      reviewer: { id: bruno, source: { system: "bamboo_api", id: "102" } },
      shared_at: "2025-07-01T09:30:00.123000Z",
      answer_count: 3,
    });
  });

  it("answers 404 for an unknown, malformed, deleted or deleted-cycle request", async () => {
    const cycle = await insertReviewCycle({
      name: "Ciclo borrado",
      deleted: true,
    });
    const participant = await insertParticipant({
      cycleId: cycle,
      personId: ana,
    });
    const inDeleted = await insertRequest({
      cycleId: cycle,
      participantId: participant,
      reviewerPersonId: ana,
      relationship: "self",
    });
    for (const id of [MISSING, "nope", deletedPeer, inDeleted]) {
      const res = await requestOf(id);
      expect(res.status, id).toBe(404);
      expect(res.type).toBe("application/problem+json");
    }
  });

  it("requires the bearer token when API_TOKEN is set", async () => {
    vi.stubEnv("API_TOKEN", "s3cret");
    expect((await requestOf(mgrDora)).status).toBe(401);
  });
});

describe("scope parameters", () => {
  it.each([
    [`role=manager`, "role"],
    [`scope=person`, "scope"],
    [`scope=hr&as_person=${MISSING}`, "scope"],
    [`as_person=nope`, "as_person"],
    [`as_person=${MISSING}&role=ceo`, "role"],
  ])("answers 400 for %s", async (query, field) => {
    const res = await requestOf(mgrDora, `?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: Json) => e.path)).toContain(field);
  });

  it("answers 404 for an as_person that is not a person", async () => {
    const res = await requestOf(mgrDora, `?as_person=${MISSING}`);
    expect(res.status).toBe(404);
    const listed = await requestsOf(cycleId, `?as_person=${MISSING}`);
    expect(listed.status).toBe(404);
  });

  it("direction never carries the person it was asked for", async () => {
    expect(
      await scopeActor(db, { as_person: dora, role: "direction" }),
    ).toEqual({ personId: null, role: "direction" });
    expect(await scopeActor(db, { as_person: dora, role: "manager" })).toEqual({
      personId: dora,
      role: "manager",
    });
  });

  it("answers 403 for a request the person may not read", async () => {
    const res = await requestOf(selfDora, `?as_person=${outsider}`);
    expect(res.status).toBe(403);
    expect(res.type).toBe("application/problem+json");
    expect((await answersOf(selfDora, `?as_person=${outsider}`)).status).toBe(
      403,
    );
  });

  const actors: [string, () => ActorContext][] = [
    ["the reviewee", () => ({ personId: dora, role: "employee" })],
    ["the snapshot manager", () => ({ personId: bruno, role: "manager" })],
    ["the skip-level manager", () => ({ personId: ana, role: "manager" })],
    ["a peer reviewer", () => ({ personId: eva, role: "employee" })],
    ["a peer with a draft", () => ({ personId: fede, role: "employee" })],
    ["a removed participant", () => ({ personId: carla, role: "employee" })],
    ["a stranger", () => ({ personId: outsider, role: "employee" })],
    ["hr acting as a person", () => ({ personId: ana, role: "hr" })],
    // Direction has no person and only reads aggregates: no request.
    ["direction", () => ({ personId: null, role: "direction" })],
  ];
  /**
   * The query that reads as `actor`. The API needs an as_person with a role;
   * for direction, which has no person, any one is given and is dropped.
   */
  const asQuery = (actor: ActorContext) =>
    `as_person=${actor.personId ?? dora}&role=${actor.role}`;

  it.each(actors)(
    "lists exactly what the review module lets %s read (canRead parity)",
    async (_who, actorOf) => {
      const actor = actorOf();
      const all = [
        selfDora,
        mgrDora,
        peerDora,
        peerDraft,
        upwardBruno,
        selfBruno,
        selfCarla,
      ];
      const readable: string[] = [];
      for (const id of all) {
        const review = await getReview(db, actor, id);
        if (review) {
          readable.push(id);
          // The answers endpoint shows the answers canRead lets through.
          const res = await answersOf(id, `?${asQuery(actor)}&limit=200`);
          expect(res.status).toBe(200);
          expect(res.body.data.map((a: Json) => a.question.id).sort()).toEqual(
            Object.keys(review.answers).sort(),
          );
        } else {
          const res = await requestOf(id, `?${asQuery(actor)}`);
          expect(res.status).toBe(403);
        }
      }
      const listed = await requestsOf(cycleId, `?${asQuery(actor)}&limit=200`);
      expect(listed.body.data.map((r: Json) => r.id).sort()).toEqual(
        readable.sort(),
      );
    },
  );

  it.each(actors)(
    "counts for %s only the answers they may read: answer_count = what /answers returns",
    async (_who, actorOf) => {
      const actor = actorOf();
      const scope = asQuery(actor);
      const listed = await requestsOf(cycleId, `?${scope}&limit=200`);
      for (const row of listed.body.data) {
        const answers = await answersOf(row.id, `?${scope}&limit=200`);
        expect(answers.body.data, row.id).toHaveLength(row.answer_count);
        const detail = await requestOf(row.id, `?${scope}`);
        expect(detail.body.data.answer_count).toBe(row.answer_count);
      }
    },
  );

  it("does not let the reviewee count the answers hidden from them", async () => {
    // The manager's rating question is hidden from the reviewee: 3 answers, 2 readable.
    expect((await requestOf(mgrDora)).body.data.answer_count).toBe(3);
    const asReviewee = await requestOf(mgrDora, `?as_person=${dora}`);
    expect(asReviewee.body.data.answer_count).toBe(2);
    const listed = await requestsOf(
      cycleId,
      `?as_person=${dora}&relationship=manager`,
    );
    expect(listed.body.data.map((r: Json) => r.answer_count)).toEqual([2]);
  });

  it("fills pages with readable rows only and still pages them stably", async () => {
    const path = `/api/v1/cycles/${cycleId}/requests?as_person=${dora}&role=employee`;
    const all = (
      await call(listCycleRequestsRoute, `${path}&limit=200`, cycleId)
    ).body.data.map((r: Json) => r.id);
    expect(all.length).toBeGreaterThan(1);
    for (const limit of [1, 2]) {
      expect(await walk(listCycleRequestsRoute, path, cycleId, limit)).toEqual(
        all,
      );
    }
  });
});

describe("GET /api/v1/requests/{id}/answers", () => {
  it("lists every answer with its question, in question order (hr scope)", async () => {
    const res = await answersOf(mgrDora);
    expect(res.status).toBe(200);
    expect(res.body.next_cursor).toBeNull();
    expect(res.body.data).toHaveLength(3);
    const [text, rating, comment] = res.body.data;
    expect(text).toMatchObject({
      request_id: mgrDora,
      question: {
        id: q1,
        prompt: { es: "¿Cómo te fue?", en: "How did it go?" },
        kind: "text",
        role: null,
        visible_to_reviewee: true,
        sort: 0,
      },
      option_value: null,
      option_label: null,
      normalized: null,
      text: "Muy bien",
    });
    expect(text.id).toMatch(UUID);
    expect(text.updated_at).toMatch(ISO);
    expect(rating).toMatchObject({
      question: {
        id: q2,
        kind: "rating",
        role: "overall_rating",
        visible_to_reviewee: false,
      },
      option_value: 3,
      option_label: "Alto",
      text: null,
    });
    expect(rating.normalized).toBeCloseTo(2 / 3, 10);
    expect(comment.question).toMatchObject({ id: q4, role: "goals_comment" });
  });

  it("gives a single choice answer as the stored choice value", async () => {
    const res = await answersOf(peerDora);
    expect(res.body.data[1]).toMatchObject({
      question: { id: q3, kind: "single_choice" },
      option_value: null,
      option_label: "team",
    });
  });

  it("answers an empty list for a request without answers", async () => {
    const res = await answersOf(peerDraft);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], next_cursor: null });
  });

  it("pages by question order, stable page after page", async () => {
    const full = await answersOf(mgrDora);
    const expected = full.body.data.map((a: Json) => a.id);
    for (const limit of [1, 2, 3]) {
      expect(
        await walk(
          listRequestAnswersRoute,
          `/api/v1/requests/${mgrDora}/answers`,
          mgrDora,
          limit,
        ),
      ).toEqual(expected);
    }
    const first = await answersOf(mgrDora, "?limit=1");
    expect(typeof first.body.next_cursor).toBe("string");
  });

  it("hides the questions the reviewee may not see once the manager review is shared", async () => {
    const asReviewee = await answersOf(mgrDora, `?as_person=${dora}`);
    expect(asReviewee.status).toBe(200);
    expect(asReviewee.body.data.map((a: Json) => a.question.id).sort()).toEqual(
      [q1, q4].sort(),
    );
    const asManager = await answersOf(
      mgrDora,
      `?as_person=${bruno}&role=manager`,
    );
    expect(asManager.body.data).toHaveLength(3);
  });

  it.each([
    ["limit=0", "limit"],
    ["cursor=garbage", "cursor"],
    [`as_person=nope`, "as_person"],
  ])("answers 400 problem+json for %s", async (query, field) => {
    const res = await answersOf(mgrDora, `?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: Json) => e.path)).toContain(field);
  });

  it("answers 404 for an unknown, malformed or deleted request", async () => {
    for (const id of [MISSING, "nope", deletedPeer]) {
      expect((await answersOf(id)).status, id).toBe(404);
    }
  });

  it("requires the bearer token when API_TOKEN is set", async () => {
    vi.stubEnv("API_TOKEN", "s3cret");
    expect((await answersOf(mgrDora)).status).toBe(401);
  });
});

describe("GET /api/v1/cycles/{id}/question-revisions", () => {
  const revisionsOf = (id: string, query = "") =>
    call(
      listQuestionRevisionsRoute,
      `/api/v1/cycles/${id}/question-revisions${query}`,
      id,
    );

  it("lists the frozen questions in order with prompts, rules, scale and choices", async () => {
    const res = await revisionsOf(cycleId);
    expect(res.status).toBe(200);
    expect(res.body.next_cursor).toBeNull();
    expect(res.body.data.map((q: Json) => q.id)).toEqual([q1, q2, q3, q4]);
    const [text, rating, choice] = res.body.data;
    expect(text).toMatchObject({
      id: q1,
      cycle_id: cycleId,
      question_id: null,
      group_id: null,
      section_title: { es: "Sección", en: "Section" },
      prompt: { es: "¿Cómo te fue?", en: "How did it go?" },
      kind: "text",
      role: null,
      applies_to: ["self", "manager", "peer", "upward"],
      visible_to_reviewee: true,
      required: false,
      scale: null,
      choices: null,
      sort: 0,
    });
    expect(text.created_at).toMatch(ISO);
    expect(rating).toMatchObject({
      role: "overall_rating",
      applies_to: ["manager"],
      visible_to_reviewee: false,
    });
    expect(rating.scale.options).toHaveLength(4);
    expect(rating.scale.options[1]).toMatchObject({
      value: 2,
      label: { es: "Medio", en: "Mid" },
    });
    expect(choice.choices).toEqual([
      { value: "team", label: { es: "Equipo", en: "Team" } },
      { value: "solo", label: { es: "Solo", en: "Solo" } },
    ]);
  });

  it("pages stably, including questions that share a sort position", async () => {
    const cycle = await insertReviewCycle({ name: "Preguntas" });
    const same = [];
    for (let i = 0; i < 4; i++) {
      same.push(
        await insertQuestion({ cycleId: cycle, sort: 5, kind: "text" }),
      );
    }
    const first = await insertQuestion({
      cycleId: cycle,
      sort: 1,
      kind: "text",
    });
    const all = (await revisionsOf(cycle, "?limit=200")).body.data.map(
      (q: Json) => q.id,
    );
    expect(all[0]).toBe(first);
    expect([...all].sort()).toEqual([first, ...same].sort());
    for (const limit of [1, 2, 3]) {
      expect(
        await walk(
          listQuestionRevisionsRoute,
          `/api/v1/cycles/${cycle}/question-revisions`,
          cycle,
          limit,
        ),
      ).toEqual(all);
    }
  });

  it("answers 404 for an unknown or malformed cycle and 400 for a bad cursor", async () => {
    expect((await revisionsOf(MISSING)).status).toBe(404);
    expect((await revisionsOf("nope")).status).toBe(404);
    const bad = await revisionsOf(cycleId, "?cursor=garbage");
    expect(bad.status).toBe(400);
  });

  it("requires the bearer token when API_TOKEN is set", async () => {
    vi.stubEnv("API_TOKEN", "s3cret");
    expect((await revisionsOf(cycleId)).status).toBe(401);
  });
});

describe("the cursor is checked before anything is looked up", () => {
  const revisionsOf = (id: string, query = "") =>
    call(
      listQuestionRevisionsRoute,
      `/api/v1/cycles/${id}/question-revisions${query}`,
      id,
    );

  it("answers 400, not 404 or 403, for a bad cursor on an unknown or unreadable target", async () => {
    const bad = "?cursor=garbage";
    for (const res of [
      await requestsOf(MISSING, bad),
      await requestsOf("not-a-uuid", bad),
      await requestsOf(MISSING, `${bad}&as_person=${MISSING}`),
      await answersOf(MISSING, bad),
      await answersOf("not-a-uuid", bad),
      await answersOf(selfDora, `${bad}&as_person=${outsider}`),
      await revisionsOf(MISSING, bad),
      await revisionsOf("not-a-uuid", bad),
    ]) {
      expect(res.status).toBe(400);
      expect(res.body.errors.map((e: Json) => e.path)).toContain("cursor");
    }
  });

  it("is checked by the query functions themselves, ids that cannot exist included", async () => {
    await expect(
      listRequestRows(db, { limit: 5, cursor: "garbage", cycleId: "nope" }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      listRequestRows(db, {
        limit: 5,
        cursor: "garbage",
        participantId: "nope",
      }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      listAnswerRows(db, "nope", { limit: 5, cursor: "garbage" }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

/** The database with every query it is asked to run counted. */
function counting() {
  let count = 0;
  const queryMethods = new Set(["execute", "select", "selectDistinct"]);
  const counted = new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      const bound = value.bind(target);
      return queryMethods.has(String(prop))
        ? (...args: unknown[]) => {
            count++;
            return bound(...args);
          }
        : bound;
    },
  });
  return { db: counted as typeof db, queries: () => count };
}

describe("queries per page", () => {
  // A page costs a fixed handful of queries (the rows, then the extras
  // canRead needs, each once per page), never a few per request: the rows
  // plus at most five extras (double blind, replaced manager, shared, skip-level,
  // current manager).
  const BUDGET = 6;
  let many: string;
  let reviewers: string[];

  beforeAll(async () => {
    many = await insertReviewCycle({ name: "Sesenta pares" });
    const participant = await insertParticipant({
      cycleId: many,
      personId: dora,
      snapManagerPersonId: bruno,
    });
    const people = await db
      .insert(person)
      .values(Array.from({ length: 60 }, (_, i) => ({ displayName: `P ${i}` })))
      .returning({ id: person.id });
    reviewers = people.map((p) => p.id);
    const ids = await insertRequests(
      reviewers.map((id) => ({
        cycleId: many,
        participantId: participant,
        reviewerPersonId: id,
        relationship: "peer" as const,
      })),
    );
    await insertAnswers(
      ids.map((requestId) => ({
        requestId,
        questionRevisionId: q1,
        textValue: "x",
      })),
    );
  });

  const actorsOfInterest: [string, () => ActorContext][] = [
    ["hr", () => ({ personId: null, role: "hr" })],
    ["the snapshot manager", () => ({ personId: bruno, role: "manager" })],
    ["the skip-level manager", () => ({ personId: ana, role: "manager" })],
    ["the reviewee", () => ({ personId: dora, role: "employee" })],
    ["a stranger", () => ({ personId: outsider, role: "employee" })],
  ];

  it.each(actorsOfInterest)(
    "reads 60 requests for %s in a bounded number of queries",
    async (_who, actorOf) => {
      const actor = actorOf();
      const spy = counting();
      const page = await listRequestRows(spy.db, {
        cycleId: many,
        limit: 200,
        actor,
      });
      expect(spy.queries()).toBeLessThanOrEqual(BUDGET);
      // The manager reads every submitted peer request; the stranger none.
      expect(page.items.length).toBe(
        actor.personId === bruno || actor.role === "hr" ? 60 : 0,
      );
    },
  );

  it("reads the same page of the scenario cycle in a bounded number of queries for every actor", async () => {
    for (const [who, actorOf] of actorsOfInterest) {
      const spy = counting();
      await listRequestRows(spy.db, {
        cycleId,
        limit: 200,
        actor: actorOf(),
      });
      expect(spy.queries(), who).toBeLessThanOrEqual(BUDGET);
    }
  });

  it("reads one request's answers in a bounded number of queries", async () => {
    const spy = counting();
    await listAnswerRows(spy.db, mgrDora, {
      limit: 200,
      actor: { personId: dora, role: "employee" },
    });
    expect(spy.queries()).toBeLessThanOrEqual(BUDGET);
  });
});
