import { describe, expect, it } from "vitest";
import type { ActorContext } from "@/modules/actor/types";
import type { CycleStatus } from "./status";
import { canRead, type VisibilityContext } from "./visibility";

// Bruno is the reviewee, Carla his snapshot manager, Alba the reviewer of
// his manager review, Dora his manager today.
const BRUNO = "bruno";
const CARLA = "carla";
const ALBA = "alba";
const DORA = "dora";

const as = (personId: string): ActorContext => ({
  personId,
  role: "manager",
});

type Opts = {
  rel: "self" | "manager";
  submitted?: boolean;
  /** Status of the participant's manager request (self rows). */
  managerStatus?: "draft" | "submitted";
  managerSharedAt?: Date | null;
  sharedAt?: Date | null;
  doubleBlind?: boolean;
  cycleStatus?: CycleStatus;
  currentManager?: boolean;
  removedAt?: Date | null;
};

function ctx(o: Opts): VisibilityContext {
  return {
    request: {
      relationship: o.rel,
      reviewerPersonId: o.rel === "self" ? BRUNO : ALBA,
      status: o.submitted === false ? "draft" : "submitted",
      sharedAt: o.rel === "manager" ? (o.sharedAt ?? null) : null,
    },
    participant: {
      revieweePersonId: BRUNO,
      snapManagerPersonId: CARLA,
      removedAt: o.removedAt ?? null,
    },
    cycle: {
      status: o.cycleStatus ?? "collecting",
      components: { doubleBlind: o.doubleBlind ?? true },
    },
    managerRequest:
      o.rel === "self"
        ? {
            status: o.managerStatus ?? "draft",
            sharedAt: o.managerSharedAt ?? null,
          }
        : undefined,
    currentManager: o.currentManager ?? false,
  };
}

describe("the current manager (a flag decided by the caller)", () => {
  const shared = new Date();

  it("reads a manager review only once it was shared with the employee", () => {
    expect(
      canRead(as(DORA), ctx({ rel: "manager", currentManager: true })),
    ).toBe(false);
    // Not even when the cycle is sharing/closed: shared_at is what counts.
    expect(
      canRead(
        as(DORA),
        ctx({ rel: "manager", currentManager: true, cycleStatus: "closed" }),
      ),
    ).toBe(false);
    expect(
      canRead(
        as(DORA),
        ctx({ rel: "manager", currentManager: true, sharedAt: shared }),
      ),
    ).toBe(true);
  });

  it("never reads a draft manager review", () => {
    expect(
      canRead(
        as(DORA),
        ctx({
          rel: "manager",
          currentManager: true,
          sharedAt: shared,
          submitted: false,
        }),
      ),
    ).toBe(false);
  });

  it("reads a submitted self review once the manager review was shared", () => {
    expect(canRead(as(DORA), ctx({ rel: "self", currentManager: true }))).toBe(
      false,
    );
    expect(
      canRead(
        as(DORA),
        ctx({
          rel: "self",
          currentManager: true,
          managerStatus: "submitted",
          managerSharedAt: shared,
        }),
      ),
    ).toBe(true);
  });

  it("reads nothing without the flag, nor of a removed participant", () => {
    expect(canRead(as(DORA), ctx({ rel: "manager", sharedAt: shared }))).toBe(
      false,
    );
    expect(
      canRead(
        as(DORA),
        ctx({
          rel: "manager",
          currentManager: true,
          sharedAt: shared,
          removedAt: new Date(),
        }),
      ),
    ).toBe(false);
  });
});
