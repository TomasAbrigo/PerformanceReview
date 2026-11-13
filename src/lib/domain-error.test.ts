import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));

import { actionResult } from "./action-result";
import { DomainError, parse } from "./domain-error";

class ThingError extends DomainError<"validation" | "missing"> {}

describe("DomainError / parse", () => {
  it("returns parsed data or throws the given error class with field issues", () => {
    const schema = z.object({ name: z.string().min(1, "required") });
    expect(parse(schema, { name: "x" }, ThingError)).toEqual({ name: "x" });
    try {
      parse(schema, { name: "" }, ThingError);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ThingError);
      expect(error).toMatchObject({
        code: "validation",
        issues: [{ path: "name", message: "required" }],
      });
    }
  });
});

describe("actionResult with DomainError", () => {
  it("can skip the page refresh", async () => {
    const { refresh } = await import("next/cache");
    vi.mocked(refresh).mockClear();
    await actionResult(async () => {}, undefined, { refreshPage: false });
    expect(refresh).not.toHaveBeenCalled();
    await actionResult(async () => {});
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("wraps values and maps domain errors to codes", async () => {
    expect(await actionResult(async () => ({ id: "a" }))).toEqual({
      ok: true,
      id: "a",
    });
    expect(
      await actionResult(async () => {
        throw new ThingError("missing");
      }),
    ).toEqual({ ok: false, code: "missing", issues: [] });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await actionResult(async () => {
        throw new Error("boom");
      }),
    ).toEqual({ ok: false, code: "unknown", issues: [] });
    log.mockRestore();
  });
});
