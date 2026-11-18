import { describe, expect, it } from "vitest";
import { MAX_PAGE } from "@/lib/paging";
import { listHref, pageParam, queryString } from "./query-string";

describe("pageParam", () => {
  it("reads a whole page number", () => {
    expect(pageParam({ page: "3" })).toBe(3);
  });

  it("is 1 for a missing, zero, negative, fractional or non-numeric page", () => {
    for (const page of [undefined, "0", "-2", "1.5", "abc", ""]) {
      expect(pageParam({ page })).toBe(1);
    }
  });

  it("never goes past the highest page, so no URL makes a huge offset", () => {
    expect(pageParam({ page: "999999999999" })).toBe(MAX_PAGE);
    expect(pageParam({ page: String(MAX_PAGE + 1) })).toBe(MAX_PAGE);
  });
});

describe("queryString", () => {
  it("keeps the params that have a value", () => {
    expect(queryString({ a: "1", b: undefined, c: "", d: 0 })).toBe("?a=1&d=0");
    expect(queryString({})).toBe("");
  });
});

describe("listHref", () => {
  it("lays the extra params over the filters, an undefined one dropping its param", () => {
    const href = listHref("/goals", { state: "overdue", q: "dora" });
    expect(href()).toBe("/goals?state=overdue&q=dora");
    expect(href({ page: 2 })).toBe("/goals?state=overdue&q=dora&page=2");
    expect(href({ state: undefined })).toBe("/goals?q=dora");
  });
});
