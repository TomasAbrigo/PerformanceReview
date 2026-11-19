import type { Sentiment, Signal, Substance } from "./constants";
import { fold } from "./dimension";
import type {
  AnalysisInput,
  AnalysisOutput,
  AnalysisProvider,
} from "./provider";
import { isImpactQuestion } from "./themes";

/**
 * Keyword lists, matched on the folded text (lowercase, no accents) at the
 * start of a word: "proactiv" hits "proactivo" but never "improactivo", and
 * "no " phrases need the whole word. A negative cue right after "sin",
 * "no" or "without" ("sin retrabajo") does not count.
 */
type Cue = "positive" | "constructive" | "negative";
const CUES: Record<Cue, string[]> = {
  positive: [
    "excelente",
    "muy bien",
    "gran ",
    "destac",
    "referente",
    "confiable",
    "a tiempo",
    "aporta",
    "ayuda",
    "con calidad",
    "excellent",
    "great ",
    "reliable",
    "helpful",
    "outstanding",
    "reconocid",
    "me siento valorad",
    "feel valued",
    "feel highly valued",
  ],
  constructive: [
    "mejorar",
    "podria",
    "puedo ser",
    "puede ser",
    "seria bueno",
    "me gustaria",
    "necesito",
    "profundizar",
    "anticipar",
    "desarrollar",
    "could",
    "should",
    "improve",
    "work on",
    "i would like",
  ],
  negative: [
    "no cumple",
    "llega tarde",
    "llego tarde",
    "es un problema",
    "fue un problema",
    "entrega tarde",
    "retrabajo",
    "conflict",
    "queja",
    "desorganiz",
    "frustr",
    "desmotiv",
    "estres",
    "burnout",
    "agotad",
    "maltrato",
    "no me siento",
    "falta de",
    "poor",
    "missed",
    "lack of",
    "complain",
    "don't feel",
    "do not feel",
    "not valued",
  ],
};

/** Theme key -> cues. Order breaks ties (People's eight first). */
const THEME_CUES: Record<string, string[]> = {
  proyecto: ["proyecto", "project", "alcance", "entregable", "scope"],
  equipo: [
    "equipo",
    "team",
    "companer",
    "colega",
    "colabor",
    "teammate",
    "collaborat",
  ],
  comunicacion: [
    "comunic",
    "escuch",
    "feedback",
    "communicat",
    "dialogo",
    "transparen",
    "reunion",
    "meeting",
  ],
  crecimiento: [
    "crecer",
    "crecim",
    "growth",
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
    "estres",
    "stress",
    "burnout",
    "carga de trabajo",
    "workload",
    "salud",
    "descanso",
  ],
  reconocimiento: [
    "reconoc",
    "recogni",
    "valorad",
    "valued",
    "aprecia",
    "agradec",
  ],
  tecnica: ["tecnic", "codigo", "arquitect", "technical", "code", "testing"],
  planificacion: [
    "planific",
    "prioriz",
    "organiz",
    "plan ",
    "planning",
    "deadline",
    "estimac",
  ],
  calidad: ["calidad", "retrabajo", "prolij", "quality", "detalle", "detail"],
  liderazgo: ["lider", "lidera", "deleg", "mentor", "lead", "guia"],
  proactividad: ["proactiv", "anticip", "iniciativa", "initiative"],
  negocio: ["negocio", "cliente", "business", "customer"],
  aprendizaje: ["aprend", "profundiz", "capacit", "learn", "curso"],
  documentacion: ["document"],
};

/** Initiative type -> cues, for the social / environmental "how". */
const IMPACT_CUES: Record<string, string[]> = {
  voluntariado: ["voluntari", "volunteer"],
  donaciones: ["donacion", "dono", "donamos", "donat", "colecta", "campana"],
  reciclaje: ["recicl", "residuo", "recycl", "waste", "compost"],
  consumo: [
    "consumo",
    "impresion",
    "imprimir",
    "papel",
    "energia",
    "plastico",
    "reduc",
    "print",
    "energy",
  ],
  educacion: ["escuela", "educa", "ensen", "taller", "school", "teach"],
  movilidad: ["bici", "transporte publico", "caminando", "carpool", "bike"],
};

/** What People has to attend to -> cues. */
const SIGNAL_CUES: Record<Signal, string[]> = {
  workload: [
    "carga de trabajo",
    "sobrecarg",
    "horas extra",
    "agotad",
    "burnout",
    "estres",
    "workload",
    "overload",
    "overtime",
  ],
  attrition: [
    "renunci",
    "irme de",
    "otro trabajo",
    "otra empresa",
    "dejar la empresa",
    "propuesta laboral",
    "quit",
    "leave the company",
    "another job",
  ],
  conflict: ["conflict", "discusion", "maltrato", "tension", "roce"],
  recognition: [
    "falta de reconocimiento",
    "sin reconocimiento",
    "no me siento valorad",
    "no valoran",
    "poco reconoc",
    "not valued",
    "don't feel valued",
    "do not feel valued",
    "lack of recognition",
  ],
  stagnation: [
    "estancad",
    "no crezco",
    "sin crecimiento",
    "mismas tareas",
    "no aprendo",
    "stagnat",
    "stuck",
    "no growth",
  ],
  company_request: [
    "la empresa deberia",
    "la empresa podria",
    "me gustaria que la empresa",
    "santex deberia",
    "deberian ofrecer",
    "the company should",
    "the company could",
  ],
  role_fit: [
    "fuera de mi rol",
    "no es mi rol",
    "cambiar de rol",
    "otro rol",
    "cambio de proyecto",
    "not my role",
    "change roles",
    "different role",
  ],
};

/** An answer that says nothing ("n/a", "nada", "-"). */
const NOTHING =
  /^(n\/?a|na|-+|\.+|nada|ninguna?|ningun|no se|nothing|none|no aplica|sin comentarios|no comments?)[.!]?$/;
/** Something concrete: a number, a quote, an example, a when. */
const CONCRETE =
  /\d|["“]|\b(por ejemplo|cuando|como en|en el proyecto|for example|for instance|when|during|durante)\b/;

const NEGATORS = ["sin ", "no ", "without ", "nunca "];

/** How many of `cues` hit `text` (folded, padded with spaces). */
function hits(text: string, cues: string[], negatable = false): number {
  let n = 0;
  for (const cue of cues) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(cue, from);
      if (at < 0) break;
      from = at + 1;
      // Start of a word only.
      if (/[a-z0-9]/.test(text[at - 1] ?? " ")) continue;
      if (negatable && NEGATORS.some((w) => text.endsWith(w, at))) continue;
      n++;
      break;
    }
  }
  return n;
}

const top = (counts: [string, number][], max: number): string[] =>
  counts
    .map((c, i) => [c[0], c[1], i] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[2] - b[2])
    .slice(0, max)
    .map(([name]) => name);

/**
 * A demo heuristic, not an analysis (provider "mock", a DEMO_PROVIDERS
 * entry): deterministic keyword cues, for demos, tests and as the default
 * when no real provider is configured. It never fabricates a tone from the
 * question: without cues a text is neutral. Its confidence is null (it does
 * not estimate one).
 */
export class MockProvider implements AnalysisProvider {
  readonly name = "mock";
  readonly promptVersion = "mock-v3";

  async analyze(batch: AnalysisInput[]): Promise<AnalysisOutput[]> {
    return batch.map((input) => analyzeOne(input));
  }
}

export function analyzeOne(input: AnalysisInput): AnalysisOutput {
  const bare = fold(input.text).replace(/\s+/g, " ").trim();
  const text = ` ${bare} `;
  const n = {
    positive: hits(text, CUES.positive),
    constructive: hits(text, CUES.constructive),
    negative: hits(text, CUES.negative, true),
  };
  let sentiment: Sentiment = "neutral";
  if (n.positive > 0 && n.negative > 0) sentiment = "mixed";
  else if (n.negative > 0) sentiment = "negative";
  else if (n.constructive > 0) sentiment = "constructive";
  else if (n.positive > 0) sentiment = "positive";

  const vocabulary =
    input.rubric === "yes_no_detail" && isImpactQuestion(input.question)
      ? IMPACT_CUES
      : THEME_CUES;
  const themes = top(
    Object.entries(vocabulary).map(([k, cues]) => [k, hits(text, cues)]),
    3,
  );
  const signals = top(
    Object.entries(SIGNAL_CUES).map(([k, cues]) => [k, hits(text, cues)]),
    7,
  ) as Signal[];

  const words = bare.split(" ").filter(Boolean).length;
  let substance: Substance;
  if (
    words <= 1 ||
    NOTHING.test(bare) ||
    // Only praise where an improvement was asked answers nothing.
    (input.rubric === "improvement" && sentiment === "positive")
  ) {
    substance = "none";
  } else if (
    words >= 6 &&
    (themes.length > 0 || signals.length > 0) &&
    (CONCRETE.test(bare) || words >= 12)
  ) {
    substance = "specific";
  } else {
    substance = "generic";
  }
  return {
    token: input.token,
    substance,
    themes,
    signals,
    sentiment,
    confidence: null,
  };
}
