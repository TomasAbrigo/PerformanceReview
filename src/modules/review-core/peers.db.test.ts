import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  cycleParticipant,
  employment,
  notification,
  peerNomination,
  person,
  reviewRequest,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import { listTemplates, seedSystemTemplates } from "@/modules/templates";
import {
  createCycle,
  CyclesError,
  declineRequest,
  decideNominations,
  findManagerRequestId,
  getReview,
  launchCycle,
  listMyTasks,
  listNominations,
  listPeerFeedback,
  listPendingApprovals,
  nominatePeer,
  openRequestsCount,
  removeParticipant,
  removeNomination,
  ReviewError,
  saveDraft,
  shareReview,
  submit,
  transition,
  updateCycle,
  type CycleInput,
  type Review,
} from ".";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

// As of 2022-06-01: Bruno reports to Carla (inactive), Carla to Ana.
let ana: string;
let bruno: string;
let carla: string;
let peers: string[]; // Dani, Eva, Fede, Gabi, Hugo, Ivan (active)
let inactive: string;
let templateId: string;

const hr: ActorContext = { personId: null, role: "hr" };
const as = (
  personId: string,
  role: ActorContext["role"] = "employee",
): ActorContext => ({ personId, role });

async function reset() {
  await db.execute(
    sql`TRUNCATE review_cycle, employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run CASCADE`,
  );
}

const idOf = async (name: string) =>
  (
    await db
      .select({ id: person.id })
      .from(person)
      .where(eq(person.displayName, name))
  )[0].id;

async function addPerson(name: string, status: string) {
  const [p] = await db
    .insert(person)
    .values({ displayName: name })
    .returning({ id: person.id });
  await db.insert(employment).values({
    personId: p.id,
    status,
    hireDate: "2020-01-01",
    sourceId: `test-${name}`,
  });
  return p.id;
}

beforeAll(async () => {
  await seedSystemTemplates(db);
  templateId = (await listTemplates(db)).find(
    (t) => t.isSystem && t.enabled,
  )!.id;
});

beforeEach(async () => {
  await reset();
  const dir = await mkdtemp(path.join(tmpdir(), "peers-"));
  await cp(FIXTURES, dir, { recursive: true });
  const adapter = new FixtureAdapter(dir);
  await runIngest({ adapter, entity: "employee", db });
  await runIngest({ adapter, entity: "job_history", db });
  await rm(dir, { recursive: true, force: true });
  [ana, bruno, carla] = await Promise.all(
    ["Ana García", "Bruno Pérez", "Carla Romero"].map(idOf),
  );
  peers = [];
  for (const n of ["Dani", "Eva", "Fede", "Gabi", "Hugo", "Ivan"]) {
    peers.push(await addPerson(n, "Active"));
  }
  inactive = await addPerson("Zoe", "Inactive");
});

afterAll(async () => {
  await reset();
  await closeDb();
});

function input(overrides: Partial<CycleInput> = {}): CycleInput {
  return {
    name: "H1 2022",
    periodStart: "2022-01-01",
    periodEnd: "2022-06-30",
    snapshotDate: "2022-06-01",
    components: {
      self: true,
      manager: true,
      peer: true,
      upward: false,
      calibration: false,
    },
    anonymity: { peer: "anonymous_to_employee", upward: "fully_anonymous" },
    templateId,
    participantFilter: { kind: "people", personIds: [ana, bruno] },
    ...overrides,
  };
}

async function nominationsCycle(overrides: Partial<CycleInput> = {}) {
  const cycle = await createCycle(db, input(overrides));
  await launchCycle(db, cycle.id, null);
  return cycle;
}

const participantOf = async (cycleId: string, personId: string) =>
  (
    await db
      .select()
      .from(cycleParticipant)
      .where(
        and(
          eq(cycleParticipant.cycleId, cycleId),
          eq(cycleParticipant.revieweePersonId, personId),
        ),
      )
  )[0];

const peerRequests = (cycleId: string) =>
  db
    .select()
    .from(reviewRequest)
    .where(
      and(
        eq(reviewRequest.cycleId, cycleId),
        eq(reviewRequest.relationship, "peer"),
      ),
    );

const fillAll = (review: Review) =>
  review.questions.map((q) => ({
    questionRevisionId: q.id,
    value:
      q.kind === "rating"
        ? q.scale!.options[0].value
        : q.kind === "single_choice"
          ? q.choices![0].value
          : `Respuesta ${q.sort}`,
  }));

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

describe("nominations", () => {
  it("lets the reviewee nominate up to the cycle maximum", async () => {
    const cycle = await nominationsCycle({
      components: {
        ...input().components,
        peerSettings: { maxNominations: 2 },
      },
    });
    const p = await participantOf(cycle.id, bruno);
    await nominatePeer(db, as(bruno), p.id, peers[0]);
    await nominatePeer(db, as(bruno), p.id, peers[1]);
    await expectCode(
      nominatePeer(db, as(bruno), p.id, peers[2]),
      "nominations_full",
    );
    // Removing one frees a slot.
    const [n] = await listNominations(db, as(bruno), p.id);
    await removeNomination(db, as(bruno), n.id);
    await nominatePeer(db, as(bruno), p.id, peers[2]);
    expect(
      (await listNominations(db, as(bruno), p.id)).filter(
        (x) => x.status === "pending",
      ),
    ).toHaveLength(2);
  });

  it("defaults the maximum to 5", async () => {
    const cycle = await nominationsCycle();
    const p = await participantOf(cycle.id, bruno);
    for (const id of peers.slice(0, 5)) {
      await nominatePeer(db, as(bruno), p.id, id);
    }
    await expectCode(
      nominatePeer(db, as(bruno), p.id, peers[5]),
      "nominations_full",
    );
  });

  it("rejects self, own manager, inactive people and duplicates", async () => {
    const cycle = await nominationsCycle();
    const p = await participantOf(cycle.id, bruno);
    await expectCode(
      nominatePeer(db, as(bruno), p.id, bruno),
      "invalid_nominee",
    );
    await expectCode(
      nominatePeer(db, as(bruno), p.id, carla),
      "invalid_nominee",
    );
    await expectCode(
      nominatePeer(db, as(bruno), p.id, inactive),
      "invalid_nominee",
    );
    await nominatePeer(db, as(bruno), p.id, peers[0]);
    await expectCode(
      nominatePeer(db, as(bruno), p.id, peers[0]),
      "already_nominated",
    );
  });

  it("only the reviewee or HR nominate, only in the nominations phase", async () => {
    const cycle = await nominationsCycle();
    const p = await participantOf(cycle.id, bruno);
    await expectCode(nominatePeer(db, as(ana), p.id, peers[0]), "forbidden");
    await nominatePeer(db, hr, p.id, peers[0]);
    await transition(db, cycle.id, "collecting", null);
    await expectCode(
      nominatePeer(db, as(bruno), p.id, peers[1]),
      "wrong_phase",
    );
  });

  it("approval creates exactly one peer request, idempotently", async () => {
    const cycle = await nominationsCycle();
    const p = await participantOf(cycle.id, bruno);
    const n = await nominatePeer(db, as(bruno), p.id, peers[0]);
    await expectCode(
      decideNominations(db, as(ana), [n.id], "approved"),
      "forbidden",
    );
    await decideNominations(db, as(carla, "manager"), [n.id], "approved");
    await decideNominations(db, as(carla, "manager"), [n.id], "approved");
    const reqs = await peerRequests(cycle.id);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({
      reviewerPersonId: peers[0],
      participantId: p.id,
      anonymous: true,
      status: "draft",
    });
  });

  it("bulk approves and declines", async () => {
    const cycle = await nominationsCycle();
    const p = await participantOf(cycle.id, bruno);
    const ids = [];
    for (const id of peers.slice(0, 3)) {
      ids.push((await nominatePeer(db, as(bruno), p.id, id)).id);
    }
    expect(await listPendingApprovals(db, as(carla, "manager"))).toHaveLength(
      3,
    );
    await decideNominations(db, hr, ids.slice(0, 2), "approved");
    await decideNominations(db, as(carla), [ids[2]], "declined");
    expect(await peerRequests(cycle.id)).toHaveLength(2);
    const list = await listNominations(db, as(bruno), p.id);
    expect(list.map((n) => n.status).sort()).toEqual([
      "approved",
      "approved",
      "declined",
    ]);
    expect(await listPendingApprovals(db, as(carla))).toHaveLength(0);
  });

  it("auto-declines pending nominations when collecting starts", async () => {
    const cycle = await nominationsCycle();
    const p = await participantOf(cycle.id, bruno);
    await nominatePeer(db, as(bruno), p.id, peers[0]);
    await transition(db, cycle.id, "collecting", null);
    const [n] = await listNominations(db, as(bruno), p.id);
    expect(n.status).toBe("declined");
    expect(await peerRequests(cycle.id)).toHaveLength(0);
  });

  it("approval 'none': nominations are approved at once, nothing to decide", async () => {
    const cycle = await nominationsCycle({
      components: {
        ...input().components,
        peerSettings: { approval: "none" },
      },
    });
    const p = await participantOf(cycle.id, bruno);
    const n = await nominatePeer(db, as(bruno), p.id, peers[0]);
    expect(n.status).toBe("approved");
    expect(await peerRequests(cycle.id)).toHaveLength(1);
    expect(await listPendingApprovals(db, as(carla))).toHaveLength(0);
    expect(await listPendingApprovals(db, hr)).toHaveLength(0);
    await expectCode(
      decideNominations(db, as(carla), [n.id], "declined"),
      "no_approval",
    );
    await transition(db, cycle.id, "collecting", null);
    expect(await peerRequests(cycle.id)).toHaveLength(1);
  });

  it("dedupes ids and rejects removed participants", async () => {
    const cycle = await nominationsCycle();
    const p = await participantOf(cycle.id, bruno);
    const n = await nominatePeer(db, as(bruno), p.id, peers[0]);
    expect(
      await decideNominations(db, as(carla), [n.id, n.id], "approved"),
    ).toBe(1);
    const n2 = await nominatePeer(db, as(bruno), p.id, peers[1]);
    await removeParticipant(db, cycle.id, bruno);
    await expectCode(
      decideNominations(db, hr, [n2.id], "approved"),
      "not_found",
    );
  });
});

describe("cycle settings", () => {
  it("rejects anonymity and nomination settings changes after launch", async () => {
    const cycle = await nominationsCycle();
    await expectCode(
      updateCycle(db, cycle.id, {
        anonymity: { peer: "transparent", upward: "transparent" },
      }),
      "not_draft",
    );
    await expectCode(
      updateCycle(db, cycle.id, {
        components: {
          ...input().components,
          peerSettings: { maxNominations: 8 },
        },
      }),
      "not_draft",
    );
    await expect(
      updateCycle(db, cycle.id, { name: "Renamed" }),
    ).resolves.toBeTruthy();
    expect(CyclesError).toBeTruthy();
  });
});

describe("peer feedback", () => {
  async function approvedCycle(
    anonymity: CycleInput["anonymity"]["peer"] = "anonymous_to_employee",
  ) {
    const cycle = await nominationsCycle({
      anonymity: { peer: anonymity, upward: "fully_anonymous" },
    });
    const p = await participantOf(cycle.id, bruno);
    const n = await nominatePeer(db, as(bruno), p.id, peers[0]);
    await decideNominations(db, as(carla), [n.id], "approved");
    await transition(db, cycle.id, "collecting", null);
    const [req] = await peerRequests(cycle.id);
    return { cycle, p, req };
  }

  async function answer(requestId: string) {
    const review = (await getReview(db, as(peers[0]), requestId))!;
    expect(review.questions.length).toBeGreaterThan(0);
    expect(review.questions.every((q) => q.appliesTo.includes("peer"))).toBe(
      true,
    );
    await saveDraft(db, as(peers[0]), requestId, fillAll(review));
    await submit(db, as(peers[0]), requestId);
  }

  /** Carla submits her review, the cycle reaches sharing, she shares. */
  async function shareManager(
    cycleId: string,
    participantId: string,
    { share = true } = {},
  ) {
    const id = (await findManagerRequestId(db, as(carla), participantId))!;
    const review = (await getReview(db, as(carla), id))!;
    await saveDraft(db, as(carla), id, fillAll(review));
    await submit(db, as(carla), id);
    await transition(db, cycleId, "manager_review", null);
    await transition(db, cycleId, "sharing", null);
    if (share) await shareReview(db, as(carla), id);
    return cycleId;
  }

  it("is written via the generic review flow and read per anonymity mode", async () => {
    const { cycle, p, req } = await approvedCycle();
    await answer(req.id);
    // The reviewee is told feedback arrived (without the author).
    const notes = await db
      .select()
      .from(notification)
      .where(eq(notification.requestId, req.id));
    expect(notes).toEqual([
      expect.objectContaining({
        recipientPersonId: bruno,
        kind: "feedback_received",
      }),
    ]);
    expect(JSON.stringify(notes[0].payload)).not.toContain("Dani");
    // The reviewee reads nothing before the share.
    expect(await getReview(db, as(bruno), req.id)).toBeNull();
    expect(await listPeerFeedback(db, as(bruno), p.id)).toHaveLength(0);
    // The manager reads it during the cycle, with the name.
    const forManager = await listPeerFeedback(db, as(carla), p.id);
    expect(forManager).toHaveLength(1);
    expect(forManager[0].reviewerName).toBe("Dani");
    // Sharing phase alone is not enough while the manager review is unshared.
    await shareManager(cycle.id, p.id, { share: false });
    expect(await listPeerFeedback(db, as(bruno), p.id)).toHaveLength(0);
    await shareReview(
      db,
      as(carla),
      (await findManagerRequestId(db, as(carla), p.id))!,
    );
    const forReviewee = await listPeerFeedback(db, as(bruno), p.id);
    expect(forReviewee).toHaveLength(1);
    expect(forReviewee[0].reviewerName).toBeNull();
    expect(forReviewee[0].reviewerVisible).toBe(false);
    const review = (await getReview(db, as(bruno), req.id))!;
    expect(review.request.reviewerPersonId).toBeNull();
  });

  it("transparent shows names to the reviewee after share", async () => {
    const { cycle, p, req } = await approvedCycle("transparent");
    await answer(req.id);
    await shareManager(cycle.id, p.id);
    const [item] = await listPeerFeedback(db, as(bruno), p.id);
    expect(item.reviewerName).toBe("Dani");
  });

  it("without manager reviews, the sharing phase releases it", async () => {
    const cycle = await nominationsCycle({
      components: { ...input().components, manager: false },
    });
    const p = await participantOf(cycle.id, bruno);
    const n = await nominatePeer(db, as(bruno), p.id, peers[0]);
    await decideNominations(db, hr, [n.id], "approved");
    await transition(db, cycle.id, "collecting", null);
    const [req] = await peerRequests(cycle.id);
    await answer(req.id);
    expect(await listPeerFeedback(db, as(bruno), p.id)).toHaveLength(0);
    await transition(db, cycle.id, "sharing", null);
    const [item] = await listPeerFeedback(db, as(bruno), p.id);
    expect(item.reviewerName).toBeNull();
    expect((await getReview(db, as(bruno), req.id))?.isAuthor).toBe(false);
    expect((await getReview(db, hr, req.id))?.isAuthor).toBe(false);
    expect((await getReview(db, as(peers[0]), req.id))?.isAuthor).toBe(true);
  });

  it("fully anonymous hides names from manager and HR too", async () => {
    const { p, req } = await approvedCycle("fully_anonymous");
    await answer(req.id);
    const [m] = await listPeerFeedback(db, as(carla), p.id);
    expect(m.reviewerName).toBeNull();
    const [h] = await listPeerFeedback(db, hr, p.id);
    expect(h.reviewerName).toBeNull();
    const [row] = await peerRequests(p.cycleId);
    expect(row.reviewerPersonId).toBe(peers[0]);
  });

  it("the peer declines with a reason, without blocking the cycle", async () => {
    const { cycle, req } = await approvedCycle();
    await expectCode(declineRequest(db, as(bruno), req.id, "no"), "forbidden");
    await expectCode(
      declineRequest(db, as(peers[0]), req.id, "  "),
      "validation",
    );
    await declineRequest(db, as(peers[0]), req.id, "No trabajé con Bruno");
    const [row] = await peerRequests(cycle.id);
    expect(row).toMatchObject({
      status: "declined",
      declineReason: "No trabajé con Bruno",
    });
    expect(row.declinedAt).not.toBeNull();
    await expect(
      transition(db, cycle.id, "manager_review", null),
    ).resolves.toBeTruthy();
    expect(ReviewError).toBeTruthy();
  });

  it("lists nomination and feedback tasks", async () => {
    const cycle = await nominationsCycle();
    const p = await participantOf(cycle.id, bruno);
    let tasks = await listMyTasks(db, as(bruno));
    expect(tasks.nominations).toEqual([
      expect.objectContaining({
        cycleId: cycle.id,
        participantId: p.id,
        nominated: 0,
        max: 5,
      }),
    ]);
    // The task stays (with the link) even when the cap is reached.
    const full = await nominationsCycle({
      name: "Full",
      components: {
        ...input().components,
        peerSettings: { maxNominations: 1 },
      },
    });
    const fp = await participantOf(full.id, bruno);
    await nominatePeer(db, as(bruno), fp.id, peers[1]);
    tasks = await listMyTasks(db, as(bruno));
    expect(tasks.nominations).toContainEqual(
      expect.objectContaining({ cycleId: full.id, nominated: 1, max: 1 }),
    );
    await transition(db, full.id, "collecting", null);
    const n = await nominatePeer(db, as(bruno), p.id, peers[0]);
    await decideNominations(db, as(carla), [n.id], "approved");
    await transition(db, cycle.id, "collecting", null);
    tasks = await listMyTasks(db, as(bruno));
    expect(tasks.nominations).toHaveLength(0);
    const peerTasks = await listMyTasks(db, as(peers[0]));
    expect(peerTasks.feedback).toEqual([
      expect.objectContaining({
        cycleId: cycle.id,
        relationship: "peer",
        revieweeName: "Bruno Pérez",
      }),
    ]);
  });
});

describe("load counter", () => {
  it("counts open requests across active cycles and flags the threshold", async () => {
    const cycle = await nominationsCycle({
      components: {
        ...input().components,
        peerSettings: { loadWarningAt: 2 },
      },
    });
    const b = await participantOf(cycle.id, bruno);
    const a = await participantOf(cycle.id, ana);
    const n1 = await nominatePeer(db, as(bruno), b.id, peers[0]);
    const n2 = await nominatePeer(db, as(ana), a.id, peers[0]);
    expect((await openRequestsCount(db, [peers[0]])).get(peers[0])).toBe(0);
    await decideNominations(db, hr, [n1.id, n2.id], "approved");
    expect((await openRequestsCount(db, [peers[0]])).get(peers[0])).toBe(2);
    const list = await listNominations(db, as(bruno), b.id);
    expect(list[0]).toMatchObject({ openRequests: 2, overloaded: true });
    const pending = await nominatePeer(db, as(bruno), b.id, peers[1]);
    const [approval] = await listPendingApprovals(db, as(carla));
    expect(approval).toMatchObject({ id: pending.id, overloaded: false });
    // Once peers can no longer write them, drafts stop counting.
    await transition(db, cycle.id, "collecting", null);
    expect((await openRequestsCount(db, [peers[0]])).get(peers[0])).toBe(2);
    await transition(db, cycle.id, "manager_review", null);
    expect((await openRequestsCount(db, [peers[0]])).get(peers[0])).toBe(0);
  });
});

describe("upward", () => {
  it("creates one upward request per direct report as of the snapshot", async () => {
    const cycle = await createCycle(
      db,
      input({
        components: {
          self: true,
          manager: true,
          peer: false,
          upward: true,
          calibration: false,
        },
        participantFilter: { kind: "people", personIds: [ana, bruno, carla] },
      }),
    );
    await launchCycle(db, cycle.id, null);
    const rows = await db
      .select()
      .from(reviewRequest)
      .where(
        and(
          eq(reviewRequest.cycleId, cycle.id),
          eq(reviewRequest.relationship, "upward"),
        ),
      );
    const c = await participantOf(cycle.id, carla);
    const a = await participantOf(cycle.id, ana);
    expect(
      rows.map((r) => [r.participantId, r.reviewerPersonId]).sort(),
    ).toEqual(
      [
        [c.id, bruno],
        [a.id, carla],
      ].sort(),
    );
    expect(rows.every((r) => r.anonymous)).toBe(true);
    // Idempotent.
    await transition(db, cycle.id, "manager_review", null);
    expect(
      await db
        .select()
        .from(reviewRequest)
        .where(eq(reviewRequest.relationship, "upward")),
    ).toHaveLength(2);
    expect(peerNomination).toBeTruthy();
  });
});
