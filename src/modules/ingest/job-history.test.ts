import { describe, expect, it } from "vitest";
import { buildNameIndex, resolveManagerName } from "./job-history";

const people = [
  { id: "p-ana", displayName: "Ana García" },
  { id: "p-martin", displayName: "Martin Paez" },
  { id: "p-cruz", displayName: "Ana María de la Cruz" },
  { id: "p-sf-1", displayName: "Santiago Fernández" },
  { id: "p-sf-2", displayName: "Santiago Fernández" },
  { id: "p-jose", displayName: "José Núñez" },
  { id: "p-jose-2", displayName: "Jose Nunez" },
];

describe("resolveManagerName (reportsTo is a name, not an id)", () => {
  const index = buildNameIndex(people);

  it("resolves Bamboo's 'Last, First' to the 'First Last' display name", () => {
    expect(resolveManagerName(index, "García, Ana")).toBe("p-ana");
  });

  it("ignores accents between the two sides: 'Páez, Martín' is 'Martin Paez'", () => {
    expect(resolveManagerName(index, "Páez, Martín")).toBe("p-martin");
  });

  it("handles multi-word names and surnames", () => {
    expect(resolveManagerName(index, "de la Cruz, Ana María")).toBe("p-cruz");
    expect(resolveManagerName(index, "DE LA CRUZ,  ana   maría ")).toBe(
      "p-cruz",
    );
  });

  it("still resolves a plain 'First Last' reportsTo", () => {
    expect(resolveManagerName(index, "Ana García")).toBe("p-ana");
  });

  it("leaves namesakes unresolved, however the name is written", () => {
    expect(resolveManagerName(index, "Fernández, Santiago")).toBeNull();
    expect(resolveManagerName(index, "Santiago Fernández")).toBeNull();
  });

  it("treats names that only differ by accents as the same name, so ambiguous", () => {
    expect(resolveManagerName(index, "Núñez, José")).toBeNull();
  });

  it("leaves unknown names and empty values unresolved", () => {
    expect(resolveManagerName(index, "Nadie, Nunca")).toBeNull();
    expect(resolveManagerName(index, "   ")).toBeNull();
    expect(resolveManagerName(index, ",")).toBeNull();
  });
});
