import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/modules/actor/access";
import { DEFAULT_SETTINGS } from "@/modules/settings/definitions";

const get = vi.fn();
const updateSettings = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get }) }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/modules/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/settings")>()),
  updateSettings: (...a: unknown[]) => updateSettings(...a),
}));

const { updateInsightsSettingsAction } = await import("./actions");
const { SettingsError } = await import("@/modules/settings");
const ID = "00000000-0000-4000-8000-000000000002";
const actAs = (actor: object) =>
  get.mockReturnValue({ value: JSON.stringify(actor) });

beforeEach(() => {
  get.mockReset();
  updateSettings.mockReset();
});

describe("updateInsightsSettingsAction", () => {
  it("saves as the acting HR and reports what changed", async () => {
    actAs({ personId: ID, role: "hr" });
    updateSettings.mockResolvedValue(["aggregation.minGroupSize"]);
    const values = { ...DEFAULT_SETTINGS, "aggregation.minGroupSize": 8 };
    expect(await updateInsightsSettingsAction(values)).toEqual({
      ok: true,
      changed: ["aggregation.minGroupSize"],
    });
    expect(updateSettings).toHaveBeenCalledWith(
      {},
      { personId: ID, role: "hr" },
      values,
    );
  });

  it("returns the validation issues so the form marks the fields", async () => {
    actAs({ personId: null, role: "hr" });
    updateSettings.mockRejectedValue(
      new SettingsError("validation", [
        { path: "aggregation.minGroupSize", message: "out_of_range" },
      ]),
    );
    expect(
      await updateInsightsSettingsAction({ "aggregation.minGroupSize": 1 }),
    ).toEqual({
      ok: false,
      code: "validation",
      issues: [{ path: "aggregation.minGroupSize", message: "out_of_range" }],
    });
  });

  it.each(["manager", "employee", "direction"] as const)(
    "%s is forbidden and nothing is saved",
    async (role) => {
      actAs({ personId: null, role });
      expect(await updateInsightsSettingsAction({})).toMatchObject({
        ok: false,
        code: "forbidden",
      });
      expect(updateSettings).not.toHaveBeenCalled();
    },
  );

  it("maps a forbidden error from the service too", async () => {
    actAs({ personId: null, role: "hr" });
    updateSettings.mockRejectedValue(new ForbiddenError("forbidden"));
    expect(await updateInsightsSettingsAction({})).toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });
});
