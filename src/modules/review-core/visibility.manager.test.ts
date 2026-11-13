import { describe, expect, it } from "vitest";
import type { ActorContext } from "@/modules/actor/types";
import { canRead, type VisibilityContext } from "./visibility";

// Bruno is the reviewee, Carla his manager (snapshot), Ana Carla's manager.
const BRUNO = "bruno";
const CARLA = "carla";
const ANA = "ana";
const OTHER = "other";

type Actor = "hr" | "reviewee" | "manager" | "skip" | "other";
const actors: Record<Actor, ActorContext> = {
  hr: { personId: null, role: "hr" },
  reviewee: { personId: BRUNO, role: "employee" },
  manager: { personId: CARLA, role: "manager" },
  skip: { personId: ANA, role: "manager" },
  other: { personId: OTHER, role: "employee" },
};

type Case = {
  actor: Actor;
  rel: "self" | "manager";
  submitted: boolean;
  shared?: boolean;
  doubleBlind: boolean;
  /** Status of the manager request (self rows under double blind). */
  managerSubmitted?: boolean;
  visible?: boolean;
  expected: boolean;
};

function ctx(c: Case): VisibilityContext {
  return {
    request: {
      relationship: c.rel,
      reviewerPersonId: c.rel === "self" ? BRUNO : CARLA,
      status: c.submitted ? "submitted" : "draft",
      sharedAt: c.shared ? new Date() : null,
    },
    participant: { revieweePersonId: BRUNO, snapManagerPersonId: CARLA },
    cycle: {
      status: "collecting",
      components: { doubleBlind: c.doubleBlind },
    },
    managerRequest:
      c.rel === "self"
        ? { status: c.managerSubmitted ? "submitted" : "draft" }
        : undefined,
    skipLevel: c.actor === "skip",
    questionRevision:
      c.visible === undefined ? undefined : { visibleToReviewee: c.visible },
  };
}

const cases: Case[] = [];
for (const doubleBlind of [true, false]) {
  for (const submitted of [true, false]) {
    for (const managerSubmitted of [true, false]) {
      const base = {
        rel: "self" as const,
        submitted,
        doubleBlind,
        managerSubmitted,
      };
      cases.push({ ...base, actor: "hr", expected: true });
      cases.push({ ...base, actor: "reviewee", expected: true });
      cases.push({
        ...base,
        actor: "manager",
        expected: submitted && (!doubleBlind || managerSubmitted),
      });
      cases.push({ ...base, actor: "skip", expected: submitted });
      cases.push({ ...base, actor: "other", expected: false });
    }
    for (const shared of [true, false]) {
      for (const visible of [true, false, undefined]) {
        const base = {
          rel: "manager" as const,
          submitted,
          doubleBlind,
          shared,
          visible,
        };
        cases.push({ ...base, actor: "hr", expected: true });
        cases.push({ ...base, actor: "manager", expected: true });
        cases.push({
          ...base,
          actor: "reviewee",
          expected: submitted && shared && visible !== false,
        });
        cases.push({ ...base, actor: "skip", expected: submitted });
        cases.push({ ...base, actor: "other", expected: false });
      }
    }
  }
}

describe("canRead matrix (self/manager × actor × state)", () => {
  it.each(cases)(
    "$actor reads $rel (submitted=$submitted shared=$shared doubleBlind=$doubleBlind managerSubmitted=$managerSubmitted visible=$visible): $expected",
    (c) => {
      expect(canRead(actors[c.actor], ctx(c))).toBe(c.expected);
    },
  );

  it("treats a missing doubleBlind setting as on", () => {
    const c = ctx({
      actor: "manager",
      rel: "self",
      submitted: true,
      doubleBlind: true,
      managerSubmitted: false,
      expected: false,
    });
    expect(
      canRead(actors.manager, { ...c, cycle: { status: "collecting" } }),
    ).toBe(false);
  });

  it("lets only HR read a request without a reviewer", () => {
    const c: VisibilityContext = {
      request: {
        relationship: "manager",
        reviewerPersonId: null,
        status: "draft",
      },
      participant: { revieweePersonId: BRUNO, snapManagerPersonId: null },
    };
    expect(canRead({ personId: null, role: "employee" }, c)).toBe(false);
    expect(canRead(actors.hr, c)).toBe(true);
  });
});
