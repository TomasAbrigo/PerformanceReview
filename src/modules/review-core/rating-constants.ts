// Drizzle-free constants shared by the schema, the domain and client components.

/** Stages of final_rating, lowest precedence first. */
export const finalRatingStages = [
  "computed",
  "manager",
  "calibrated",
  "override",
] as const;
export type FinalRatingStage = (typeof finalRatingStages)[number];
