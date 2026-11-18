import { describe, expect, it } from "vitest";
import { clampPage, MAX_PAGE } from "./paging";

describe("clampPage", () => {
  it("keeps a page inside the pages there are", () => {
    expect(clampPage(2, 60, 25)).toBe(2);
    expect(clampPage(3, 60, 25)).toBe(3);
    expect(clampPage(4, 60, 25)).toBe(3);
    expect(clampPage(9999, 60, 25)).toBe(3);
  });

  it("falls back to the first page for a missing, zero, negative or invalid page", () => {
    expect(clampPage(undefined, 60, 25)).toBe(1);
    expect(clampPage(0, 60, 25)).toBe(1);
    expect(clampPage(-4, 60, 25)).toBe(1);
    expect(clampPage(Number.NaN, 60, 25)).toBe(1);
    expect(clampPage(Infinity, 60, 25)).toBe(1);
  });

  it("has one page when there is nothing", () => {
    expect(clampPage(5, 0, 25)).toBe(1);
  });

  it("never reads past MAX_PAGE, whatever the list is said to hold", () => {
    expect(clampPage(10 ** 12, Number.MAX_SAFE_INTEGER, 25)).toBe(MAX_PAGE);
  });
});
