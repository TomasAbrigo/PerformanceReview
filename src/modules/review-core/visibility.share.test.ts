import { describe, expect, it } from "vitest";
import type { ActorContext } from "@/modules/actor/types";
import {
  canRead,
  canShare,
  isActiveParticipant,
  shareableNow,
  type VisibilityContext,
} from "./visibility";

const BRUNO = "bruno";
const CARLA = "carla";
const ANA = "ana";
const bruno: ActorContext = { personId: BRUNO, role: "employee" };
const carla: ActorContext = { personId: CARLA, role: "manager" };
const ana: ActorContext = { personId: ANA, role: "manager" };
const hr: ActorContext = { personId: null, role: "hr" };

const managerReview = (
  overrides: Partial<VisibilityContext> = {},
  removedAt: Date | null = null,
): VisibilityContext => ({
  request: {
    relationship: "manager",
    reviewerPersonId: CARLA,
    status: "submitted",
    sharedAt: new Date(),
  },
  participant: {
    revieweePersonId: BRUNO,
    snapManagerPersonId: CARLA,
    removedAt,
  },
  cycle: { status: "sharing" },
  ...overrides,
});

describe("removed participants", () => {
  it("isActiveParticipant", () => {
    expect(isActiveParticipant({ removedAt: null })).toBe(true);
    expect(isActiveParticipant({ removedAt: new Date() })).toBe(false);
  });

  it("hides a shared review from a removed reviewee; HR and the reviewer still read it", () => {
    expect(canRead(bruno, managerReview())).toBe(true);
    const removed = managerReview({}, new Date());
    expect(canRead(bruno, removed)).toBe(false);
    expect(canRead(ana, { ...removed, skipLevel: true })).toBe(false);
    expect(canRead(carla, removed)).toBe(true);
    expect(canRead(hr, removed)).toBe(true);
  });
});

describe("skip-level reading manager reviews", () => {
  it("waits for sharing (shared_at or the sharing/closed phase)", () => {
    const unshared = managerReview({
      request: {
        relationship: "manager",
        reviewerPersonId: CARLA,
        status: "submitted",
        sharedAt: null,
      },
      skipLevel: true,
    });
    expect(
      canRead(ana, { ...unshared, cycle: { status: "manager_review" } }),
    ).toBe(false);
    expect(canRead(ana, unshared)).toBe(true); // sharing phase
    expect(canRead(ana, { ...unshared, cycle: { status: "closed" } })).toBe(
      true,
    );
  });
});

describe("canShare", () => {
  const share = (
    actor: ActorContext,
    snapManager: string | null = CARLA,
    removedAt: Date | null = null,
  ) =>
    canShare(actor, {
      request: { relationship: "manager", reviewerPersonId: CARLA },
      participant: { snapManagerPersonId: snapManager, removedAt },
    });

  it("allows HR, the reviewer and the snapshot manager of an active participant", () => {
    expect(share(hr)).toBe(true);
    expect(share(carla)).toBe(true);
    expect(share(ana, ANA)).toBe(true);
    expect(share(ana)).toBe(false);
    expect(share(bruno)).toBe(false);
    expect(share(carla, CARLA, new Date())).toBe(false);
  });

  it("only applies to manager reviews", () => {
    expect(
      canShare(hr, {
        request: { relationship: "self", reviewerPersonId: BRUNO },
        participant: { snapManagerPersonId: CARLA, removedAt: null },
      }),
    ).toBe(false);
  });
});

describe("shareableNow", () => {
  it.each([
    ["collecting", false, null, false],
    ["manager_review", false, null, false],
    ["calibration", true, null, false],
    ["sharing", false, null, true],
    ["closed", false, null, false],
    ["sharing", true, null, false],
    ["sharing", true, new Date(), true],
  ] as const)(
    "%s (calibration=%s, published=%s): %s",
    (status, calibration, calibrationPublishedAt, expected) => {
      expect(
        shareableNow({
          status,
          components: { calibration },
          calibrationPublishedAt,
        }),
      ).toBe(expected);
    },
  );
});
