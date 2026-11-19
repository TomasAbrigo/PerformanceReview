import { describe, expect, it } from "vitest";
import { signals, substances } from "./constants";
import { MockProvider } from "./mock-provider";
import type { AnalysisInput, Rubric } from "./provider";
import { IMPACT_THEMES, THEMES } from "./themes";

const input = (
  token: string,
  rubric: Rubric,
  text: string,
  question = "¿Qué hago bien?",
): AnalysisInput => ({
  token,
  dimension: rubric === "yes_no_detail" ? "custom_x" : rubric,
  rubric,
  question: { es: question, en: question },
  relationship: "self",
  yesNo: rubric === "yes_no_detail" ? "yes" : null,
  text,
});

describe("MockProvider (demo heuristic)", () => {
  const p = new MockProvider();

  it("names itself as the mock and estimates no confidence", async () => {
    expect(p.name).toBe("mock");
    const [out] = await p.analyze([
      input("a", "strengths", "Es referente técnico del equipo."),
    ]);
    expect(out.confidence).toBeNull();
  });

  it("is deterministic and keeps to the vocabulary", async () => {
    const batch = [
      input("a", "strengths", "Es referente, entrega con mucha calidad."),
      input(
        "b",
        "improvement",
        "Podría mejorar la planificación de sus tiempos.",
      ),
      input("c", "open", "Llega tarde y hay retrabajo; me frustra."),
    ];
    const first = await p.analyze(batch);
    expect(first.map((r) => r.sentiment)).toEqual([
      "positive",
      "constructive",
      "negative",
    ]);
    expect(first[1].themes).toContain("planificacion");
    for (const r of first) {
      expect(substances).toContain(r.substance);
      expect(r.themes.length).toBeLessThanOrEqual(3);
      for (const t of r.themes)
        expect(THEMES as readonly string[]).toContain(t);
      for (const s of r.signals) expect(signals).toContain(s);
    }
    expect(await p.analyze(batch)).toEqual(first);
  });

  it("never takes its tone from the question", async () => {
    const out = await p.analyze([
      input("x", "strengths", "zzz yyy xxx www vvv uuu ttt"),
      input("y", "improvement", "zzz yyy xxx www vvv uuu ttt"),
    ]);
    expect(out.map((r) => r.sentiment)).toEqual(["neutral", "neutral"]);
  });

  it("matches whole-word cues and reads negation (the audit's mislabels)", async () => {
    const [cargo, proactivo, liderar, norte] = await p.analyze([
      input(
        "1",
        "strengths",
        "Me hago cargo de los problemas hasta resolverlos.",
      ),
      input("2", "improvement", "Puedo ser más proactivo pidiendo feedback."),
      input("3", "improvement", "Me gustaría animarme a liderar reuniones."),
      input(
        "4",
        "open",
        'Mi mejor trabajo fue el proyecto "Norte": entregamos a tiempo, sin retrabajo.',
      ),
    ]);
    expect(cargo.sentiment).not.toBe("negative");
    expect(proactivo.sentiment).toBe("constructive");
    expect(proactivo.themes).toContain("proactividad");
    expect(liderar.sentiment).toBe("constructive");
    expect(liderar.themes).toContain("liderazgo");
    expect(norte.sentiment).toBe("positive");
  });

  it("reads substance: nothing, only praise in improvement, generic, specific", async () => {
    const out = await p.analyze([
      input("n", "improvement", "N/A"),
      input("p", "improvement", "Es excelente, un referente."),
      input("g", "strengths", "Trabaja bien en equipo."),
      input(
        "s",
        "strengths",
        "Cuando el cliente cambió el alcance del proyecto, replanificó el sprint con el equipo en dos días.",
      ),
    ]);
    expect(out.map((r) => r.substance)).toEqual([
      "none",
      "none",
      "generic",
      "specific",
    ]);
  });

  it("raises the signals People has to attend to", async () => {
    const [load, leave, ask] = await p.analyze([
      input("w", "open", "La carga de trabajo es muy alta y hago horas extra."),
      input(
        "a",
        "open",
        "Estoy pensando en irme de la empresa a otra empresa.",
      ),
      input("c", "open", "La empresa debería ofrecer más capacitaciones."),
    ]);
    expect(load.signals).toContain("workload");
    expect(leave.signals).toContain("attrition");
    expect(ask.signals).toContain("company_request");
  });

  it("reads the impact 'how' as initiative types", async () => {
    const q = '¿Contribuyo con iniciativas de "Impacto social"? ¿Cómo?';
    const [vol, rec] = await p.analyze([
      input(
        "v",
        "yes_no_detail",
        "con el voluntariado de la escuela del barrio.",
        q,
      ),
      input(
        "r",
        "yes_no_detail",
        "separando residuos y reduciendo impresiones.",
        q,
      ),
    ]);
    expect(vol.themes).toContain("voluntariado");
    expect(rec.themes).toEqual(
      expect.arrayContaining(["reciclaje", "consumo"]),
    );
    for (const t of [...vol.themes, ...rec.themes]) {
      expect(IMPACT_THEMES as readonly string[]).toContain(t);
    }
  });
});
