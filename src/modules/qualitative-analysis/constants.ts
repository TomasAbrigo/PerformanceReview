// Drizzle- and server-free: shared by the schema, the domain and client components.

/**
 * The five sentiments, in display order (best to worst, with neutral and
 * mixed between constructive and negative, as People's dashboard shows them).
 */
export const sentiments = [
  "positive",
  "constructive",
  "neutral",
  "mixed",
  "negative",
] as const;
export type Sentiment = (typeof sentiments)[number];

/** Spanish and English names of each sentiment, as a label CSV may spell them. */
const SENTIMENT_NAMES: Record<string, Sentiment> = {
  positive: "positive",
  positivo: "positive",
  constructive: "constructive",
  constructivo: "constructive",
  neutral: "neutral",
  neutro: "neutral",
  mixed: "mixed",
  mixto: "mixed",
  negative: "negative",
  negativo: "negative",
};

/** The sentiment a label spells (es or en, any case or accent), else null. */
export function parseSentiment(raw: string): Sentiment | null {
  const key = raw.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  return Object.hasOwn(SENTIMENT_NAMES, key) ? SENTIMENT_NAMES[key] : null;
}

/**
 * Whether an answer answers what was asked (#128): "none" (nothing: "n/a",
 * only praise where an improvement was asked), "generic" (something, but
 * vague) or "specific" (a concrete behaviour, situation, result or action).
 */
export const substances = ["none", "generic", "specific"] as const;
export type Substance = (typeof substances)[number];

/**
 * What People has to attend to, whatever the question (#128): workload,
 * attrition (wants to leave), conflict, recognition (lack of it), stagnation,
 * company_request (asks the company for something) and role_fit.
 */
export const signals = [
  "workload",
  "attrition",
  "conflict",
  "recognition",
  "stagnation",
  "company_request",
  "role_fit",
] as const;
export type Signal = (typeof signals)[number];

/** The answer of a yes/no question (parseYesNo, yesNoAnswerSql). */
export type YesNo = "yes" | "no";

/**
 * Where an effective label comes from, in precedence order (#128): a human
 * correction beats an imported label, which beats a machine label.
 */
export const labelOrigins = ["human", "import", "machine"] as const;
export type LabelOrigin = (typeof labelOrigins)[number];

export const analysisRunStatuses = ["running", "succeeded", "error"] as const;
export type AnalysisRunStatus = (typeof analysisRunStatuses)[number];

export const analysisProviderNames = ["mock", "anthropic"] as const;
export type AnalysisProviderName = (typeof analysisProviderNames)[number];

/**
 * Providers whose labels are a demo heuristic, not an analysis: the screens
 * must say so (eff.demo).
 */
export const DEMO_PROVIDERS: readonly string[] = ["mock"];

/** Provider name of the runs that record a label import. */
export const IMPORT_PROVIDER = "import";
/** Provider name of the human corrections (as an effective label source). */
export const HUMAN_SOURCE = "human";
