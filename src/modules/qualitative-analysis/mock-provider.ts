import type { Sentiment } from "./constants";
import { fold } from "./dimension";
import type {
  AnalysisInput,
  AnalysisOutput,
  AnalysisProvider,
} from "./provider";

/** es/en keyword stems per sentiment (matched on folded text, as prefixes). */
type Lexical = "positive" | "constructive" | "negative";
const LEXICON: Record<Lexical, string[]> = {
  positive: [
    "excelente",
    "muy bien",
    "gran",
    "destac",
    "referente",
    "calidad",
    "confiable",
    "proactiv",
    "ayuda",
    "colabor",
    "lidera",
    "a tiempo",
    "aport",
    "excellent",
    "great",
    "strong",
    "reliable",
    "helpful",
    "outstanding",
    "well",
    "best",
    "mejor trabajo",
    "reconocid",
    "valorad",
    "totalmente de acuerdo",
    "strongly agree",
  ],
  constructive: [
    "mejorar",
    "podria",
    "puede",
    "seria bueno",
    "necesito",
    "quiero",
    "profundizar",
    "trabajar",
    "anticipar",
    "desarrollar",
    "aprender",
    "could",
    "should",
    "improve",
    "work on",
    "develop",
    "learn",
    "more",
    "mas ",
  ],
  negative: [
    "no cumple",
    "tarde",
    "error",
    "problema",
    "falta",
    "conflict",
    "queja",
    "desorganiz",
    "retrabajo",
    "nunca",
    "poor",
    "late",
    "missed",
    "lack",
    "problem",
    "never",
    "complain",
    "not at all",
    "nada",
    "estres",
    "burnout",
    "burocr",
    "totalmente en desacuerdo",
    "strongly disagree",
  ],
};

/**
 * Theme -> keyword stems. Names are the normalized theme keys: the initial
 * vocabulary first (it wins ties), then the legacy themes of the first runs.
 */
const THEMES: Record<string, string[]> = {
  proyecto: [
    "proyecto",
    "project",
    "alcance",
    "entregable",
    "scope",
    "roadmap",
  ],
  equipo: ["equipo", "team", "compañer", "colega", "teammate"],
  comunicacion: [
    "comunic",
    "avis",
    "escuch",
    "feedback",
    "communicat",
    "dialogo",
    "transparen",
  ],
  crecimiento: [
    "crecer",
    "crecim",
    "growth",
    "grow",
    "carrera",
    "career",
    "ascenso",
    "promocion",
    "promotion",
  ],
  cultura: ["cultura", "culture", "valores", "values", "clima", "inclusi"],
  procesos: [
    "proceso",
    "process",
    "metodolog",
    "procedimiento",
    "herramienta",
    "burocr",
    "workflow",
  ],
  bienestar: [
    "bienestar",
    "wellbeing",
    "well-being",
    "estres",
    "stress",
    "burnout",
    "balance",
    "carga de trabajo",
    "workload",
    "salud",
    "descanso",
  ],
  reconocimiento: [
    "reconoc",
    "recogni",
    "valorad",
    "valorar",
    "valued",
    "valoro",
    "aprecia",
    "agradec",
  ],
  planificacion: [
    "planific",
    "tiempo",
    "prioriz",
    "organiz",
    "plan",
    "deadline",
  ],
  calidad: ["calidad", "retrabajo", "prolij", "quality", "detail"],
  liderazgo: ["lider", "referente", "deleg", "mentor", "lead", "guia"],
  colaboracion: ["equipo", "colabor", "ayuda", "compañer", "team", "help"],
  tecnica: ["tecnic", "codigo", "arquitect", "technical", "code"],
  documentacion: ["document", "continuar"],
  proactividad: ["proactiv", "anticip", "iniciativa", "riesgo", "initiative"],
  negocio: ["negocio", "cliente", "business", "customer"],
  aprendizaje: ["aprend", "profundiz", "capacit", "learn", "curso"],
};
const THEME_ORDER = new Map(Object.keys(THEMES).map((t, i) => [t, i]));

const count = (text: string, stems: string[]) =>
  stems.reduce((n, s) => n + (text.includes(s) ? 1 : 0), 0);

/** Fallback sentiment of a dimension when no keyword hits. */
const DEFAULTS: Record<string, Sentiment> = {
  strengths: "positive",
  improvement: "constructive",
};

/** A text of up to this many words, without lexicon hits, is neutral. */
const SHORT_WORDS = 3;

/**
 * Deterministic keyword heuristic: same input, same output. For demos, tests
 * and as the default when no real provider is configured. Rules, in order:
 * positive and negative hits together = mixed; else the sentiment with most
 * hits; without hits, a closed-question label or a short text is neutral;
 * else the dimension's default (constructive when it has none).
 */
export class MockProvider implements AnalysisProvider {
  readonly name = "mock";
  readonly promptVersion = "mock-v2";

  async analyze(batch: AnalysisInput[]): Promise<AnalysisOutput[]> {
    return batch.map((input) => analyzeOne(input));
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function analyzeOne(input: AnalysisInput): AnalysisOutput {
  const text = ` ${fold(input.text)} `;
  const hits = (Object.keys(LEXICON) as Lexical[]).map(
    (s) => [s, count(text, LEXICON[s])] as const,
  );
  const total = hits.reduce((n, [, h]) => n + h, 0);
  const n = Object.fromEntries(hits) as Record<Lexical, number>;
  let sentiment: Sentiment = DEFAULTS[input.dimension] ?? "constructive";
  let confidence = 0.3;
  if (n.positive > 0 && n.negative > 0) {
    sentiment = "mixed";
    const both = n.positive + n.negative;
    confidence = round2(
      0.4 + 0.6 * ((2 * Math.min(n.positive, n.negative)) / both),
    );
  } else if (total > 0) {
    const [best, hit] = [...hits].sort((a, b) => b[1] - a[1])[0];
    sentiment = best;
    confidence = round2(0.4 + 0.6 * (hit / total));
  } else if (input.closed) {
    sentiment = "neutral";
    confidence = 0.5;
  } else if (input.text.trim().split(/\s+/).length <= SHORT_WORDS) {
    sentiment = "neutral";
  }
  const themes = Object.entries(THEMES)
    .map(([name, stems]) => [name, count(text, stems)] as const)
    .filter(([, hit]) => hit > 0)
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        (THEME_ORDER.get(a[0]) ?? 0) - (THEME_ORDER.get(b[0]) ?? 0),
    )
    .slice(0, 3)
    .map(([name]) => name);
  return { token: input.token, sentiment, confidence, themes };
}
