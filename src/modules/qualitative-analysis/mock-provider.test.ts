import { describe, expect, it } from "vitest";
import { MockProvider } from "./mock-provider";

describe("MockProvider", () => {
  const p = new MockProvider();
  it("labels by keywords and is deterministic", async () => {
    const batch = [
      {
        token: "a",
        dimension: "strengths",
        text: "Es referente, entrega con mucha calidad.",
      },
      {
        token: "b",
        dimension: "improvement",
        text: "Podría mejorar la planificación de sus tiempos.",
      },
      {
        token: "c",
        dimension: "other",
        text: "Siempre llega tarde y hay retrabajo, un problema.",
      },
    ];
    const first = await p.analyze(batch);
    expect(first.map((r) => r.sentiment)).toEqual([
      "positive",
      "constructive",
      "negative",
    ]);
    expect(first[1].themes).toContain("planificacion");
    expect(first[0].themes.length).toBeGreaterThan(0);
    for (const r of first) {
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
      expect(r.themes.length).toBeLessThanOrEqual(3);
    }
    expect(await p.analyze(batch)).toEqual(first);
  });
  it("falls back to the dimension's default without hits", async () => {
    const [r] = await p.analyze([
      { token: "x", dimension: "strengths", text: "zzz" },
    ]);
    expect(r).toEqual({
      token: "x",
      sentiment: "positive",
      confidence: 0.3,
      themes: [],
    });
  });
});
