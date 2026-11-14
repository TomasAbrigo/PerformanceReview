import { describe, expect, it } from "vitest";
import { nameWords, normalizeName, orderedName } from "./normalize";

describe("normalizeName", () => {
  it("ignores case, accents, punctuation and extra whitespace", () => {
    expect(normalizeName("  Ana   GARCÍA ")).toBe(normalizeName("ana garcia"));
    expect(normalizeName("O'Brien, José")).toBe(normalizeName("jose o brien"));
  });

  it("ignores the order of the words (Last, First vs First Last)", () => {
    expect(normalizeName("García, Ana")).toBe(normalizeName("Ana García"));
  });

  it("matches Bamboo's 'Last, First' to a display name, accents and all", () => {
    expect(normalizeName("Páez, Martín")).toBe(normalizeName("Martin Paez"));
    expect(normalizeName("Núñez, José")).toBe(normalizeName("Jose Nunez"));
  });

  it("keeps multi-word first names and surnames together", () => {
    expect(normalizeName("de la Cruz, Ana María")).toBe(
      normalizeName("Ana María de la Cruz"),
    );
    expect(normalizeName("DE LA  CRUZ ,Ana  María")).toBe(
      normalizeName("ana maría de la cruz"),
    );
  });

  it("keeps different names apart", () => {
    expect(normalizeName("Ana García")).not.toBe(normalizeName("Ana Garza"));
  });
});

describe("nameWords / orderedName", () => {
  it("keep the order of the words, folding accents, case and punctuation", () => {
    expect(nameWords("  María   JOSÉ López")).toEqual([
      "maria",
      "jose",
      "lopez",
    ]);
    expect(orderedName("O'Brien, José")).toBe("o brien jose");
  });

  it("tell apart names that only differ in the order of their words", () => {
    expect(orderedName("María José López")).not.toBe(
      orderedName("José María López"),
    );
    expect(normalizeName("María José López")).toBe(
      normalizeName("José María López"),
    );
  });
});
