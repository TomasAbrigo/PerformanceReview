import { describe, expect, it } from "vitest";
import { containsPattern } from "./sql";

describe("containsPattern", () => {
  it("matches the text anywhere", () => {
    expect(containsPattern("dora")).toBe("%dora%");
  });

  it("escapes the wildcards so a name is searched as typed", () => {
    expect(containsPattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
  });
});
