import type { Sentiment } from "./constants";
import { fold } from "./dimension";
import type {
  AnalysisInput,
  AnalysisOutput,
  AnalysisProvider,
} from "./provider";

/** es/en keyword stems per sentiment (matched on folded text, as prefixes). */
const LEXICON: Record<Sentiment, string[]> = {
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
  ],
};

/** Theme -> keyword stems. Names are the normalized theme keys. */
const THEMES: Record<string, string[]> = {
  comunicacion: ["comunic", "avis", "escuch", "feedback", "communicat"],
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

const count = (text: string, stems: string[]) =>
  stems.reduce((n, s) => n + (text.includes(s) ? 1 : 0), 0);

/** Fallback sentiment of a dimension when no keyword hits. */
const DEFAULTS: Record<string, Sentiment> = {
  strengths: "positive",
  improvement: "constructive",
};

/**
 * Deterministic keyword heuristic: same input, same output. For demos, tests
 * and as the default when no real provider is configured.
 */
export class MockProvider implements AnalysisProvider {
  readonly name = "mock";
  readonly promptVersion = "mock-v1";

  async analyze(batch: AnalysisInput[]): Promise<AnalysisOutput[]> {
    return batch.map((input) => analyzeOne(input));
  }
}

export function analyzeOne(input: AnalysisInput): AnalysisOutput {
  const text = ` ${fold(input.text)} `;
  const hits = (Object.keys(LEXICON) as Sentiment[]).map(
    (s) => [s, count(text, LEXICON[s])] as const,
  );
  const total = hits.reduce((n, [, h]) => n + h, 0);
  let sentiment: Sentiment = DEFAULTS[input.dimension] ?? "constructive";
  let confidence = 0.3;
  if (total > 0) {
    const [best, n] = [...hits].sort((a, b) => b[1] - a[1])[0];
    sentiment = best;
    confidence = Math.round((0.4 + 0.6 * (n / total)) * 100) / 100;
  }
  const themes = Object.entries(THEMES)
    .map(([name, stems]) => [name, count(text, stems)] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([name]) => name);
  return { token: input.token, sentiment, confidence, themes };
}
