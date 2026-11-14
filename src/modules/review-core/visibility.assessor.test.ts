import { describe, expect, it } from "vitest";
import type { ActorContext } from "@/modules/actor/types";
import {
  canRead,
  canShare,
  canWrite,
  type VisibilityContext,
} from "./visibility";

// #17: an alternate/additional assessor (Dora) writes the manager review of
// Bruno, whose snapshot manager is Carla.
const dora: ActorContext = { personId: "dora", role: "manager" };
const stranger: ActorContext = { personId: "other", role: "manager" };

const selfOf = (over: Partial<VisibilityContext> = {}): VisibilityContext => ({
  request: {
    relationship: "self",
    reviewerPersonId: "bruno",
    status: "submitted",
  },
  participant: { revieweePersonId: "bruno", snapManagerPersonId: "carla" },
  cycle: { status: "collecting", components: { doubleBlind: true } },
  managerRequest: { status: "draft" },
  ...over,
});

describe("assessor visibility", () => {
  it("reads a submitted self review like the manager, under double blind", () => {
    expect(canRead(dora, selfOf())).toBe(false); // not an assessor
    expect(canRead(dora, selfOf({ assessor: true }))).toBe(false); // blind
    expect(
      canRead(
        dora,
        selfOf({ assessor: true, managerRequest: { status: "submitted" } }),
      ),
    ).toBe(true);
    expect(
      canRead(
        dora,
        selfOf({
          assessor: true,
          cycle: { status: "collecting", components: { doubleBlind: false } },
        }),
      ),
    ).toBe(true);
  });

  it("never reads a self draft, nor does a stranger read anything", () => {
    const draft = selfOf({
      assessor: true,
      managerRequest: { status: "submitted" },
      request: {
        relationship: "self",
        reviewerPersonId: "bruno",
        status: "draft",
      },
    });
    expect(canRead(dora, draft)).toBe(false);
    expect(
      canRead(stranger, selfOf({ managerRequest: { status: "submitted" } })),
    ).toBe(false);
  });

  it("writes only the request it reviews, while it is a draft", () => {
    const scope = {
      cycle: { status: "collecting" as const },
      participant: { removedAt: null },
    };
    const mine = {
      relationship: "manager" as const,
      reviewerPersonId: "dora",
      status: "draft" as const,
    };
    expect(canWrite(dora, mine, scope)).toBe(true);
    expect(canWrite(dora, { ...mine, status: "superseded" }, scope)).toBe(
      false,
    );
    expect(canWrite(dora, { ...mine, reviewerPersonId: "carla" }, scope)).toBe(
      false,
    );
  });
});

describe("a replaced snapshot manager", () => {
  const carla: ActorContext = { personId: "carla", role: "manager" };
  const managerOf = (
    over: Partial<VisibilityContext> = {},
    status: "draft" | "submitted" = "submitted",
  ): VisibilityContext => ({
    request: {
      relationship: "manager",
      reviewerPersonId: "dora",
      status,
    },
    participant: { revieweePersonId: "bruno", snapManagerPersonId: "carla" },
    cycle: { status: "collecting", components: { doubleBlind: true } },
    ...over,
  });

  it("reads the manager review of the participant until HR replaces them", () => {
    expect(canRead(carla, managerOf({}, "draft"))).toBe(true);
    expect(canRead(carla, managerOf({ snapManagerReplaced: false }))).toBe(
      true,
    );
    expect(
      canRead(carla, managerOf({ snapManagerReplaced: true }, "draft")),
    ).toBe(false);
    expect(canRead(carla, managerOf({ snapManagerReplaced: true }))).toBe(
      false,
    );
  });

  it("no longer reads the self review as the manager", () => {
    const self = selfOf({ managerRequest: { status: "submitted" } });
    expect(canRead(carla, self)).toBe(true);
    expect(canRead(carla, { ...self, snapManagerReplaced: true })).toBe(false);
    // ...unless they also write an additional review (assessor).
    expect(
      canRead(carla, { ...self, snapManagerReplaced: true, assessor: true }),
    ).toBe(true);
  });

  it("still reads what they wrote themselves", () => {
    const own = managerOf({ snapManagerReplaced: true });
    own.request.reviewerPersonId = "carla";
    expect(canRead(carla, own)).toBe(true);
  });

  it("cannot share, while HR, the reviewer and the snapshot manager can", () => {
    const participant = { snapManagerPersonId: "carla", removedAt: null };
    const request = {
      relationship: "manager" as const,
      reviewerPersonId: "dora",
    };
    expect(canShare(carla, { request, participant })).toBe(true);
    expect(
      canShare(carla, { request, participant, snapManagerReplaced: true }),
    ).toBe(false);
    expect(
      canShare(dora, { request, participant, snapManagerReplaced: true }),
    ).toBe(true);
    expect(
      canShare({ personId: null, role: "hr" }, { request, participant }),
    ).toBe(true);
  });
});
