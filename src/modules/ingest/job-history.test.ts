import { describe, expect, it } from "vitest";
import { buildNameIndex, resolveManagerName } from "./job-history";

const always = [{ from: null, to: null }];

/** People employed since forever, unless said otherwise. */
const person = (
  id: string,
  displayName: string,
  employed: { from: string | null; to: string | null }[] = always,
) => ({ id, displayName, employed });

const people = [
  person("p-ana", "Ana García"),
  person("p-martin", "Martin Paez"),
  person("p-cruz", "Ana María de la Cruz"),
  person("p-sf-1", "Santiago Fernández"),
  person("p-sf-2", "Santiago Fernández"),
  person("p-jose", "José Núñez"),
  person("p-jose-2", "Jose Nunez"),
  person("p-mj", "María José López"),
  person("p-jm", "José María López"),
];

const DATE = "2022-06-01";
const resolve = (raw: string, index = buildNameIndex(people), onDate = DATE) =>
  resolveManagerName(index, raw, onDate);

describe("resolveManagerName (reportsTo is a name, not an id)", () => {
  it("resolves Bamboo's 'Last, First' to the 'First Last' display name", () => {
    expect(resolve("García, Ana")).toEqual({
      personId: "p-ana",
      fuzzy: false,
    });
  });

  it("ignores accents between the two sides: 'Páez, Martín' is 'Martin Paez'", () => {
    expect(resolve("Páez, Martín")).toEqual({
      personId: "p-martin",
      fuzzy: false,
    });
  });

  it("handles multi-word names and surnames", () => {
    expect(resolve("de la Cruz, Ana María")?.personId).toBe("p-cruz");
    expect(resolve("DE LA CRUZ,  ana   maría ")?.personId).toBe("p-cruz");
  });

  it("still resolves a plain 'First Last' reportsTo", () => {
    expect(resolve("Ana García")).toEqual({ personId: "p-ana", fuzzy: false });
  });

  it("does not mix up names with the same words in another order", () => {
    // "María José López" and "José María López" are two different people.
    expect(resolve("López, María José")).toEqual({
      personId: "p-mj",
      fuzzy: false,
    });
    expect(resolve("López, José María")).toEqual({
      personId: "p-jm",
      fuzzy: false,
    });
  });

  it("leaves unresolved a reordered name that two people could be", () => {
    // Same words as both of them, in an order that is neither's.
    expect(resolve("López José María")).toBeNull();
    expect(resolve("María López José")).toBeNull();
  });

  it("falls back to the words in any order, flagged as a fuzzy match", () => {
    const index = buildNameIndex([person("p-jm", "José María López")]);
    // Bamboo's own order is Last, First: this is not what it would write.
    expect(resolve("López, María José", index)).toEqual({
      personId: "p-jm",
      fuzzy: true,
    });
    expect(resolve("García Ana")).toEqual({ personId: "p-ana", fuzzy: true });
  });

  it("leaves namesakes unresolved, however the name is written", () => {
    expect(resolve("Fernández, Santiago")).toBeNull();
    expect(resolve("Santiago Fernández")).toBeNull();
  });

  it("treats names that only differ by accents as the same name, so ambiguous", () => {
    expect(resolve("Núñez, José")).toBeNull();
  });

  it("leaves unknown names and empty values unresolved", () => {
    expect(resolve("Nadie, Nunca")).toBeNull();
    expect(resolve("   ")).toBeNull();
    expect(resolve(",")).toBeNull();
  });
});

describe("resolveManagerName on a date (a name can be reused over time)", () => {
  const index = buildNameIndex([
    person("p-old", "Carla Romero", [{ from: "2018-05-01", to: "2024-06-30" }]),
    person("p-new", "Carla Romero", [{ from: "2025-02-01", to: null }]),
    person("p-ana", "Ana García"),
  ]);

  it("picks whoever was employed on the date of the row", () => {
    expect(resolveManagerName(index, "Romero, Carla", "2021-07-15")).toEqual({
      personId: "p-old",
      fuzzy: false,
    });
    expect(resolveManagerName(index, "Romero, Carla", "2025-03-01")).toEqual({
      personId: "p-new",
      fuzzy: false,
    });
  });

  it("counts the last day of employment, and not the one after", () => {
    expect(
      resolveManagerName(index, "Romero, Carla", "2024-06-30")?.personId,
    ).toBe("p-old");
    expect(resolveManagerName(index, "Romero, Carla", "2024-07-01")).toBeNull();
  });

  it("leaves it unresolved when nobody (or both) had that name on the date", () => {
    expect(resolveManagerName(index, "Romero, Carla", "2024-12-01")).toBeNull();
    const overlap = buildNameIndex([
      person("p-1", "Carla Romero", [{ from: "2018-05-01", to: null }]),
      person("p-2", "Carla Romero", [{ from: "2020-01-01", to: null }]),
    ]);
    expect(resolveManagerName(overlap, "Romero, Carla", "2021-01-01")).toBe(
      null,
    );
  });

  it("follows a rehired person across employment periods", () => {
    const rehired = buildNameIndex([
      person("p-1", "Carla Romero", [
        { from: "2018-05-01", to: "2019-12-31" },
        { from: "2022-01-01", to: null },
      ]),
      person("p-2", "Carla Romero", [{ from: "2020-01-01", to: "2021-12-31" }]),
    ]);
    expect(
      resolveManagerName(rehired, "Romero, Carla", "2019-01-01")?.personId,
    ).toBe("p-1");
    expect(
      resolveManagerName(rehired, "Romero, Carla", "2021-01-01")?.personId,
    ).toBe("p-2");
    expect(
      resolveManagerName(rehired, "Romero, Carla", "2023-01-01")?.personId,
    ).toBe("p-1");
  });

  it("resolves the only person with the name even if the dates do not fit", () => {
    // Hired after the row's date (the data disagree): still the only Ana.
    const one = buildNameIndex([
      person("p-ana", "Ana García", [{ from: "2023-01-01", to: null }]),
    ]);
    expect(resolveManagerName(one, "García, Ana", "2021-01-01")?.personId).toBe(
      "p-ana",
    );
  });
});
