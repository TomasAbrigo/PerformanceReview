import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const createCycle = vi.fn();
const launchCycle = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get }) }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/modules/review-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/review-core")>()),
  createCycle: (...a: unknown[]) => createCycle(...a),
  launchCycle: (...a: unknown[]) => launchCycle(...a),
}));

const actions = await import("./actions");
const { ReviewError } = await import("@/modules/review-core");
const ID = "00000000-0000-4000-8000-000000000002";
const actAs = (actor: object) =>
  get.mockReturnValue({ value: JSON.stringify(actor) });
const input = {
  name: "H1",
  periodStart: "2025-03-29",
  periodEnd: "2025-09-28",
};

beforeEach(() => {
  get.mockReset();
  createCycle.mockReset();
  launchCycle.mockReset();
});

describe("cycle actions", () => {
  it("create the cycle as People and return its id", async () => {
    actAs({ personId: null, role: "hr" });
    createCycle.mockResolvedValue({ id: ID });
    expect(await actions.createCycleAction(input)).toEqual({
      ok: true,
      id: ID,
    });
    expect(createCycle).toHaveBeenCalledWith(
      {},
      { personId: null, role: "hr" },
      input,
    );
  });

  it("return the validation issues of a bad cycle", async () => {
    actAs({ personId: null, role: "hr" });
    createCycle.mockRejectedValue(
      new ReviewError("validation", [{ path: "name", message: "required" }]),
    );
    expect(await actions.createCycleAction(input)).toEqual({
      ok: false,
      code: "validation",
      issues: [{ path: "name", message: "required" }],
    });
  });

  it("are forbidden for everyone but People, without running", async () => {
    for (const actor of [
      { personId: ID, role: "manager" },
      { personId: ID, role: "employee" },
      { personId: null, role: "direction" },
    ]) {
      actAs(actor);
      expect(await actions.createCycleAction(input)).toMatchObject({
        ok: false,
        code: "forbidden",
      });
      expect(await actions.launchCycleAction(ID)).toMatchObject({
        ok: false,
        code: "forbidden",
      });
      expect(await actions.reopenRequestAction(ID)).toMatchObject({
        ok: false,
        code: "forbidden",
      });
    }
    expect(createCycle).not.toHaveBeenCalled();
    expect(launchCycle).not.toHaveBeenCalled();
  });
});
