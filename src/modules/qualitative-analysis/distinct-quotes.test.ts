import { describe, expect, it } from "vitest";
import { distinctQuotes } from "./queries";

describe("distinctQuotes", () => {
  it("keeps the first three different quotes", () => {
    expect(distinctQuotes(["a", "A ", "b", "", "b", "c", "d"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
