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

export const analysisRunStatuses = ["running", "succeeded", "error"] as const;
export type AnalysisRunStatus = (typeof analysisRunStatuses)[number];

export const analysisProviderNames = ["mock", "anthropic"] as const;
export type AnalysisProviderName = (typeof analysisProviderNames)[number];

/** Provider name of the runs that record a label import. */
export const IMPORT_PROVIDER = "import";
/** Provider name of the human corrections (as an effective label source). */
export const HUMAN_SOURCE = "human";
