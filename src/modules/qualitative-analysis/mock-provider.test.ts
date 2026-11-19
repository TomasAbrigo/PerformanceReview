import { describe, expect, it } from "vitest";
import { TEXT_BANK, type BankEntry } from "@/fixtures/company/text-bank";
import { signals, substances } from "./constants";
import { evaluateProvider } from "./eval";
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

describe("MockProvider reads the tone by rubric", () => {
  const p = new MockProvider();
  const tone = async (rubric: Rubric, text: string, yesNo?: "yes" | "no") => {
    const [out] = await p.analyze([
      {
        ...input(
          "t",
          rubric,
          text,
          rubric === "yes_no_detail"
            ? '¿Contribuyo con iniciativas de "Impacto social"? ¿Cómo?'
            : undefined,
        ),
        yesNo: yesNo ?? null,
      },
    ]);
    return out.sentiment;
  };

  it("an improvement that proposes a step is constructive, even naming a problem", async () => {
    expect(
      await tone(
        "improvement",
        "Con Facundo discutieron varias veces; conviene acordar reglas antes de arrancar.",
      ),
    ).toBe("constructive");
    expect(
      await tone("improvement", "Tengo que priorizar mejor los pedidos."),
    ).toBe("constructive");
  });

  it("an improvement that only complains or threatens to leave is negative", async () => {
    expect(await tone("improvement", "Siento que falta reconocimiento.")).toBe(
      "negative",
    );
    expect(
      await tone(
        "improvement",
        "Estoy evaluando otras ofertas porque no veo un camino de crecimiento claro.",
      ),
    ).toBe("negative");
  });

  it("praise with a caveat in a strengths answer is mixed", async () => {
    expect(
      await tone(
        "strengths",
        "Tiene muy buen nivel técnico, pero chocó varias veces con el equipo de producto.",
      ),
    ).toBe("mixed");
  });

  it("what someone did, with no adjective, is praise in a strengths answer", async () => {
    expect(
      await tone(
        "strengths",
        "Armé la guía de onboarding y ya la usaron los últimos tres ingresos.",
      ),
    ).toBe("positive");
  });

  it("a wish under 'what would help me' is a request, constructive", async () => {
    expect(await tone("open", "Más tiempo para capacitarme.")).toBe(
      "constructive",
    );
    expect(await tone("open", "Fewer meetings.")).toBe("constructive");
  });

  it("a yes needs evidence of what was done to read as positive", async () => {
    expect(
      await tone("yes_no_detail", "con el voluntariado de la escuela.", "yes"),
    ).toBe("positive");
    expect(await tone("yes_no_detail", "zzz yyy xxx www", "yes")).toBe(
      "neutral",
    );
    expect(await tone("yes_no_detail", "todavía no.", "no")).toBe("neutral");
  });

  it("reads 'N/A' and 'no sé' as no answer", async () => {
    const out = await p.analyze([
      input("a", "strengths", "N/A"),
      input("b", "strengths", "No sé, mejor que lo diga mi líder."),
    ]);
    expect(out.map((r) => r.substance)).toEqual(["none", "none"]);
    expect(out[1].sentiment).toBe("neutral");
  });
});

/**
 * The reference bank (`TEXT_BANK`) split by a hash of the text: 70 % "dev"
 * (what the cues were tuned looking at) and 30 % "test" (never looked at while
 * tuning). The floors are on the test part, a bit below what the heuristic
 * reached there, so a later change cannot silently degrade the demo; the dev
 * part has to stay close, or the cues were fitted to the sentences.
 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
const isHoldOut = (e: BankEntry) => fnv1a(e.text) % 10 >= 7;
const DEV = TEXT_BANK.filter((e) => !isHoldOut(e));
const HOLD_OUT = TEXT_BANK.filter(isHoldOut);

describe("MockProvider against the reference bank (dev / test split)", () => {
  const p = new MockProvider();

  it("splits the bank about 70 / 30", () => {
    const share = HOLD_OUT.length / TEXT_BANK.length;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.4);
  });

  it("holds its floors on the texts it was not tuned on", async () => {
    const r = await evaluateProvider(p, HOLD_OUT);
    expect(r.substance.value).toBeGreaterThanOrEqual(0.88);
    expect(r.tone.value).toBeGreaterThanOrEqual(0.8);
    expect(r.yesNo.value).toBe(1);
    expect(r.signalsPrecision.value).toBeGreaterThanOrEqual(0.85);
    expect(r.signalsRecall.value).toBeGreaterThanOrEqual(0.85);
    // Themes are a semantic call among 16 keys; lexical cues reach about
    // 55 % on unseen texts (the former heuristic: 46 %).
    expect(r.themes.value).toBeGreaterThanOrEqual(0.5);
  });

  it("does not read the tuning texts far better than the others", async () => {
    const dev = await evaluateProvider(p, DEV);
    const hold = await evaluateProvider(p, HOLD_OUT);
    expect(dev.substance.value - hold.substance.value).toBeLessThan(0.1);
    expect(dev.tone.value - hold.tone.value).toBeLessThan(0.15);
    expect(dev.themes.value - hold.themes.value).toBeLessThan(0.2);
  });
});
