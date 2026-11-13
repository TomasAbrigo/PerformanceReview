import { beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
const exists = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("./queries", () => ({
  personExists: (...a: unknown[]) => exists(...a),
}));

const { setActorAction } = await import("./actions");
const ID = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  set.mockReset();
  exists.mockReset();
});

describe("setActorAction", () => {
  it("sets an httpOnly lax cookie for an existing person", async () => {
    exists.mockResolvedValue(true);
    expect(await setActorAction(ID, "employee")).toEqual({ ok: true });
    expect(set).toHaveBeenCalledWith(
      "pr_actor",
      JSON.stringify({ personId: ID, role: "employee" }),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
      }),
    );
  });

  it("rejects an unknown person", async () => {
    exists.mockResolvedValue(false);
    expect(await setActorAction(ID, "employee")).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("accepts HR without a person and rejects bad roles", async () => {
    expect(await setActorAction(null, "hr")).toEqual({ ok: true });
    expect(exists).not.toHaveBeenCalled();
    expect(await setActorAction(null, "god" as never)).toMatchObject({
      ok: false,
      code: "validation",
    });
  });
});
