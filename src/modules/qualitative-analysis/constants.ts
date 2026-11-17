// Drizzle- and server-free: shared by the schema, the domain and client components.

export const sentiments = ["positive", "constructive", "negative"] as const;
export type Sentiment = (typeof sentiments)[number];

export const analysisRunStatuses = ["running", "succeeded", "error"] as const;
export type AnalysisRunStatus = (typeof analysisRunStatuses)[number];

export const analysisProviderNames = ["mock", "anthropic"] as const;
export type AnalysisProviderName = (typeof analysisProviderNames)[number];

/** Provider name of the runs that record a label import. */
export const IMPORT_PROVIDER = "import";
/** Provider name of the human corrections (as an effective label source). */
export const HUMAN_SOURCE = "human";
