import { describe, expect, it } from "vitest";
import type { ActorContext } from "@/modules/actor/types";
import type { CycleStatus } from "./status";
import { canRead, type VisibilityContext } from "./visibility";

// Bruno is the reviewee, Carla his snapshot manager, Alba an assigned
// assessor of his manager review (#17), Dora his manager today.
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
  /** The actor writes a manager review of the participant (the loader's flag). */
  assessor?: boolean;
  /** HR replaced the snapshot manager as the reviewer (#17). */
  replaced?: boolean;
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
    assessor: o.assessor ?? false,
    snapManagerReplaced: o.replaced ?? false,
  };
}

describe("an assigned assessor reads the self review (the loader flags them)", () => {
  it("under the same double blind as the snapshot manager", () => {
    // Not before the manager review is submitted...
    expect(canRead(as(ALBA), ctx({ rel: "self", assessor: true }))).toBe(false);
    expect(canRead(as(CARLA), ctx({ rel: "self" }))).toBe(false);
    // ...then yes, exactly like the snapshot manager.
    expect(
      canRead(
        as(ALBA),
        ctx({ rel: "self", managerStatus: "submitted", assessor: true }),
      ),
    ).toBe(true);
    expect(
      canRead(as(CARLA), ctx({ rel: "self", managerStatus: "submitted" })),
    ).toBe(true);
  });

  it("without double blind once the self review is submitted, never a draft", () => {
    expect(
      canRead(
        as(ALBA),
        ctx({ rel: "self", doubleBlind: false, assessor: true }),
      ),
    ).toBe(true);
    expect(
      canRead(
        as(ALBA),
        ctx({
          rel: "self",
          doubleBlind: false,
          submitted: false,
          assessor: true,
        }),
      ),
    ).toBe(false);
  });

  it("not for a stranger, even with a submitted manager review", () => {
    expect(
      canRead(as("other"), ctx({ rel: "self", managerStatus: "submitted" })),
    ).toBe(false);
  });

  it("not once the participant was removed", () => {
    expect(
      canRead(
        as(ALBA),
        ctx({
          rel: "self",
          managerStatus: "submitted",
          assessor: true,
          removedAt: new Date(),
        }),
      ),
    ).toBe(false);
  });
});

describe("a snapshot manager HR replaced (#17) loses access", () => {
  const shared = new Date();

  it("no self review, even with the manager review submitted", () => {
    expect(
      canRead(
        as(CARLA),
        ctx({ rel: "self", managerStatus: "submitted", replaced: true }),
      ),
    ).toBe(false);
  });

  it("the assessor who replaced them reads it", () => {
    expect(
      canRead(
        as(ALBA),
        ctx({
          rel: "self",
          managerStatus: "submitted",
          assessor: true,
          replaced: true,
        }),
      ),
    ).toBe(true);
  });

  it("no manager review either", () => {
    expect(
      canRead(
        as(CARLA),
        ctx({ rel: "manager", sharedAt: shared, replaced: true }),
      ),
    ).toBe(false);
  });
});

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
