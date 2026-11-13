import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ refresh }));

import { actionResult } from "./action-result";

class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly issues: string[] = [],
  ) {
    super(code);
  }
}
const isDomainError = (e: unknown): e is DomainError =>
  e instanceof DomainError;

describe("actionResult", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns ok, spreads what the action returned and refreshes the page", async () => {
    expect(
      await actionResult(async () => ({ id: "x" }), isDomainError),
    ).toEqual({ ok: true, id: "x" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("returns plain ok for an action that returns nothing", async () => {
    expect(await actionResult(async () => {}, isDomainError)).toEqual({
      ok: true,
    });
  });

  it("turns a domain error into its code and extra fields, without refreshing", async () => {
    const result = await actionResult(async () => {
      throw new DomainError("not_found", ["a"]);
    }, isDomainError);

    expect(result).toEqual({ ok: false, code: "not_found", issues: ["a"] });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("hides anything else behind code unknown and logs it", async () => {
    const result = await actionResult(async () => {
      throw new Error("db down");
    }, isDomainError);

    expect(result).toEqual({ ok: false, code: "unknown", issues: [] });
    expect(console.error).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
