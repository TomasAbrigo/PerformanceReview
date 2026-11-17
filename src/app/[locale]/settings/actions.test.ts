import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const actAs = (role: string) =>
  get.mockReturnValue({ value: JSON.stringify({ personId: null, role }) });
const createScale = vi.fn();
const deleteTemplate = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get }) }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/modules/templates", () => ({
  TemplatesError: class TemplatesError extends Error {},
  createScale: (...a: unknown[]) => createScale(...a),
  deleteTemplate: (...a: unknown[]) => deleteTemplate(...a),
}));

const { createScaleAction, deleteTemplateAction } = await import("./actions");

beforeEach(() => {
  get.mockReset();
  createScale.mockReset();
  deleteTemplate.mockReset();
});

describe("scales and templates actions are People only", () => {
  it("run for HR", async () => {
    actAs("hr");
    createScale.mockResolvedValue({});
    expect(await createScaleAction({ name: {}, options: [] } as never)).toEqual(
      { ok: true },
    );
    expect(createScale).toHaveBeenCalledOnce();
  });

  it.each(["manager", "employee", "direction"] as const)(
    "answer forbidden to %s without touching the data",
    async (role) => {
      actAs(role);
      expect(await createScaleAction({} as never)).toMatchObject({
        ok: false,
        code: "forbidden",
      });
      expect(await deleteTemplateAction("any")).toMatchObject({
        ok: false,
        code: "forbidden",
      });
      expect(createScale).not.toHaveBeenCalled();
      expect(deleteTemplate).not.toHaveBeenCalled();
    },
  );
});
