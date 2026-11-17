import { describe, expect, it } from "vitest";
import { parseSentiment, sentiments } from "./constants";

describe("sentiments", () => {
  it("are five, in display order", () => {
    expect([...sentiments]).toEqual([
      "positive",
      "constructive",
      "neutral",
      "mixed",
      "negative",
    ]);
  });
});

describe("parseSentiment", () => {
  it.each([
    ["positive", "positive"],
    ["Positivo", "positive"],
    ["CONSTRUCTIVO", "constructive"],
    ["constructive", "constructive"],
    ["Neutral", "neutral"],
    ["neutro", "neutral"],
    ["Mixto", "mixed"],
    ["mixed", "mixed"],
    [" Negativo ", "negative"],
    ["negative", "negative"],
  ] as const)("%s is %s", (raw, expected) => {
    expect(parseSentiment(raw)).toBe(expected);
  });
  it("is null for anything else", () => {
    expect(parseSentiment("feliz")).toBeNull();
    expect(parseSentiment("")).toBeNull();
  });
});
