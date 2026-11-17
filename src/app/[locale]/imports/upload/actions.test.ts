import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const actAs = (role: string) =>
  get.mockReturnValue({ value: JSON.stringify({ personId: null, role }) });
const storeUpload = vi.fn();
const runUploadWorker = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get }) }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/modules/lake/upload-store", () => ({
  UploadError: class UploadError extends Error {},
  storeUpload: (...a: unknown[]) => storeUpload(...a),
}));
vi.mock("@/modules/lake/upload-runs", () => ({
  markUploadRunsFailed: vi.fn(),
}));
vi.mock("@/modules/lake/upload-worker", () => ({
  runUploadWorker: (...a: unknown[]) => runUploadWorker(...a),
}));

const { importUploadAction, inspectUploadAction } = await import("./actions");

beforeEach(() => {
  for (const fn of [get, storeUpload, runUploadWorker]) fn.mockReset();
});

const form = () => {
  const data = new FormData();
  data.set("file", new File(["a,b\n1,2\n"], "x.csv"));
  return data;
};
const importInput = {
  uploadId: `${"a".repeat(64)}.csv`,
  profile: { builtin: "bamboo-employee-performance" },
};

describe("upload actions are People only", () => {
  it.each(["manager", "employee", "direction"] as const)(
    "%s cannot store or import a file",
    async (role) => {
      actAs(role);
      expect(await inspectUploadAction(form())).toMatchObject({
        ok: false,
        code: "forbidden",
      });
      expect(await importUploadAction(importInput as never)).toMatchObject({
        ok: false,
        code: "forbidden",
      });
      expect(storeUpload).not.toHaveBeenCalled();
      expect(runUploadWorker).not.toHaveBeenCalled();
    },
  );

  it("HR goes on to store the file", async () => {
    actAs("hr");
    storeUpload.mockResolvedValue({ id: "u1", size: 8, existed: false });
    runUploadWorker.mockResolvedValue({ ok: true, columns: [], rows: [] });
    expect(await inspectUploadAction(form())).toMatchObject({ ok: true });
    expect(storeUpload).toHaveBeenCalledOnce();
  });
});
