import { describe, expect, it } from "vitest";
import { MockProvider } from "./mock-provider";
import { INITIAL_THEMES } from "./themes";

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
  it("falls back to the dimension's default without hits on a long text", async () => {
    const batch = [
      {
        token: "x",
        dimension: "strengths",
        text: "zzz yyy xxx www vvv uuu ttt",
      },
      {
        token: "y",
        dimension: "improvement",
        text: "zzz yyy xxx www vvv uuu ttt",
      },
    ];
    expect((await p.analyze(batch)).map((r) => r.sentiment)).toEqual([
      "positive",
      "constructive",
    ]);
  });
  it("is neutral without lexicon hits when the text is short or a closed-question label", async () => {
    const out = await p.analyze([
      { token: "s", dimension: "strengths", text: "zzz" },
      { token: "c", dimension: "valued", text: "Somewhat", closed: true },
      {
        token: "l",
        dimension: "valued",
        text: "zzz yyy xxx www vvv uuu ttt",
        closed: true,
      },
    ]);
    expect(out.map((r) => r.sentiment)).toEqual([
      "neutral",
      "neutral",
      "neutral",
    ]);
    expect(out[0].confidence).toBe(0.3);
    expect(out[0].themes).toEqual([]);
  });
  it("is mixed when the text has both positive and negative hits", async () => {
    const [r, en] = await p.analyze([
      {
        token: "m",
        dimension: "other",
        text: "Gran calidad y muy confiable, pero siempre llega tarde y hay retrabajo.",
      },
      {
        token: "e",
        dimension: "other",
        text: "Excellent and reliable work but there is a problem, always late.",
      },
    ]);
    expect(r.sentiment).toBe("mixed");
    expect(en.sentiment).toBe("mixed");
    expect(r.confidence).toBeGreaterThan(0.4);
  });
  it("positive wins over neutral: closed labels with lexicon hits keep their sentiment", async () => {
    const [r, n] = await p.analyze([
      { token: "a", dimension: "valued", text: "Very well", closed: true },
      { token: "b", dimension: "valued", text: "Not at all", closed: true },
    ]);
    expect(r.sentiment).toBe("positive");
    expect(n.sentiment).toBe("negative");
  });
  it("tags the eight initial themes (es and en)", async () => {
    const texts: [string, string][] = [
      ["proyecto", "El proyecto tiene un alcance claro."],
      ["equipo", "Buen trabajo en equipo con mis compañeros."],
      ["comunicacion", "Falta comunicación y feedback."],
      ["crecimiento", "Quiero crecer en mi carrera."],
      ["cultura", "La cultura y los valores de la empresa."],
      ["procesos", "Los procesos son lentos y burocráticos."],
      ["bienestar", "Mucho estrés y carga de trabajo."],
      ["reconocimiento", "Me siento reconocido y valorado."],
      ["bienestar", "The workload causes burnout."],
      ["crecimiento", "I want career growth."],
    ];
    const out = await p.analyze(
      texts.map(([, text], i) => ({
        token: `t${i}`,
        dimension: "other",
        text,
      })),
    );
    texts.forEach(([theme], i) => expect(out[i].themes).toContain(theme));
    for (const theme of INITIAL_THEMES) {
      expect(texts.map(([t]) => t)).toContain(theme);
    }
  });
  it("has its own prompt version", () => {
    expect(p.promptVersion).toBe("mock-v2");
  });
});
