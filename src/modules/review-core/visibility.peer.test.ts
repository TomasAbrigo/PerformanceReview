import { describe, expect, it } from "vitest";
import type { ActorContext } from "@/modules/actor/types";
import type { AnonymityMode } from "./status";
import { canRead, reviewerVisible, type VisibilityContext } from "./visibility";

// Bruno is the reviewee, Carla his manager, Dani the peer giving feedback.
const actors = {
  hr: { personId: null, role: "hr" },
  reviewee: { personId: "bruno", role: "employee" },
  manager: { personId: "carla", role: "manager" },
  peer: { personId: "dani", role: "employee" },
  other: { personId: "other", role: "employee" },
} satisfies Record<string, ActorContext>;
type Actor = keyof typeof actors;

function ctx(
  mode: AnonymityMode,
  { submitted = true, shared = false, rel = "peer" as "peer" | "upward" } = {},
): VisibilityContext {
  return {
    request: {
      relationship: rel,
      reviewerPersonId: "dani",
      status: submitted ? "submitted" : "draft",
    },
    participant: { revieweePersonId: "bruno", snapManagerPersonId: "carla" },
    cycle: {
      status: "collecting",
      anonymity: { peer: mode, upward: mode },
    },
    revieweeShared: shared,
  };
}

const modes: AnonymityMode[] = [
  "transparent",
  "anonymous_to_employee",
  "fully_anonymous",
];

describe("canRead peer/upward", () => {
  for (const mode of modes) {
    for (const rel of ["peer", "upward"] as const) {
      describe(`${rel} ${mode}`, () => {
        const cases: [Actor, boolean, boolean][] = [
          // actor, shared, expected (submitted request)
          ["reviewee", false, false],
          ["reviewee", true, true],
          ["manager", false, true],
          ["manager", true, true],
          ["hr", false, true],
          ["hr", true, true],
          ["peer", false, true],
          ["other", true, false],
        ];
        it.each(cases)("%s shared=%s -> %s", (actor, shared, expected) => {
          expect(canRead(actors[actor], ctx(mode, { shared, rel }))).toBe(
            expected,
          );
        });
      });
    }
  }

  it("drafts are only read by their author (and HR)", () => {
    const c = ctx("transparent", { submitted: false, shared: true });
    expect(canRead(actors.reviewee, c)).toBe(false);
    expect(canRead(actors.manager, c)).toBe(false);
    expect(canRead(actors.peer, c)).toBe(true);
  });

  it("the reviewee does not read questions hidden from them", () => {
    const c = {
      ...ctx("transparent", { shared: true }),
      questionRevision: { visibleToReviewee: false },
    };
    expect(canRead(actors.reviewee, c)).toBe(false);
  });
});

describe("reviewerVisible", () => {
  const expected: Record<AnonymityMode, Record<Actor, boolean>> = {
    transparent: {
      hr: true,
      reviewee: true,
      manager: true,
      peer: true,
      other: true,
    },
    anonymous_to_employee: {
      hr: true,
      reviewee: false,
      manager: true,
      peer: true,
      other: true,
    },
    fully_anonymous: {
      hr: false,
      reviewee: false,
      manager: false,
      peer: true,
      other: false,
    },
  };
  for (const mode of modes) {
    for (const actor of Object.keys(actors) as Actor[]) {
      it(`${mode} ${actor}`, () => {
        expect(
          reviewerVisible(actors[actor], ctx(mode, { shared: true })),
        ).toBe(expected[mode][actor]);
      });
    }
  }

  it("self/manager reviewers are always visible", () => {
    const c = ctx("fully_anonymous");
    c.request = { ...c.request, relationship: "manager" };
    expect(reviewerVisible(actors.reviewee, c)).toBe(true);
  });
});
