import { describe, expect, it } from "vitest";
import en from "./en.json";
import es from "./es.json";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("i18n messages", () => {
  it("es and en define exactly the same keys", () => {
    expect(keyPaths(en).sort()).toEqual(keyPaths(es).sort());
  });
});
