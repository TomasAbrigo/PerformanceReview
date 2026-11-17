import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get }) }));

const { onlyHr } = await import("./server");
const ID = "00000000-0000-4000-8000-000000000002";
const cookie = (actor: object) => ({ value: JSON.stringify(actor) });

beforeEach(() => get.mockReset());

describe("onlyHr (server actions of People-only screens)", () => {
  it("runs the action for People (the default actor too)", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    get.mockReturnValue(undefined);
    expect(await onlyHr(run)).toEqual({ ok: true });
    get.mockReturnValue(cookie({ personId: ID, role: "hr" }));
    expect(await onlyHr(run)).toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["manager", { personId: ID, role: "manager" }],
    ["employee", { personId: ID, role: "employee" }],
    ["direction", { personId: null, role: "direction" }],
  ])("does not run it for %s and answers forbidden", async (_name, actor) => {
    const run = vi.fn();
    get.mockReturnValue(cookie(actor));
    expect(await onlyHr(run)).toMatchObject({
      ok: false,
      code: "forbidden",
      issues: [],
    });
    expect(run).not.toHaveBeenCalled();
  });
});
