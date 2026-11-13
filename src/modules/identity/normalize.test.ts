import { describe, expect, it } from "vitest";
import { normalizeName } from "./normalize";

describe("normalizeName", () => {
  it("ignores case, accents, punctuation and extra whitespace", () => {
    expect(normalizeName("  Ana   GARCÍA ")).toBe(normalizeName("ana garcia"));
    expect(normalizeName("O'Brien, José")).toBe(normalizeName("jose o brien"));
  });

  it("ignores the order of the words (Last, First vs First Last)", () => {
    expect(normalizeName("García, Ana")).toBe(normalizeName("Ana García"));
  });

  it("keeps different names apart", () => {
    expect(normalizeName("Ana García")).not.toBe(normalizeName("Ana Garza"));
  });
});
