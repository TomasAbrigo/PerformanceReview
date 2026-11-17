import { describe, expect, it } from "vitest";
import { textHash } from "./text-hash";

describe("textHash", () => {
  it("ignores case, accents and whitespace", () => {
    expect(textHash("  Comunicación   CLARA\n")).toBe(
      textHash("comunicacion clara"),
    );
    expect(textHash("a")).not.toBe(textHash("b"));
    expect(textHash("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
