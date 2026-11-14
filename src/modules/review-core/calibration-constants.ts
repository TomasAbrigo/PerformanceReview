// Drizzle-free constants shared by the schema, the domain and client components.

export const calibrationGroupKinds = [
  "by_department",
  "by_manager",
  "manual",
] as const;
export type CalibrationGroupKind = (typeof calibrationGroupKinds)[number];

/** Stages of final_rating, lowest precedence first. */
export const finalRatingStages = [
  "computed",
  "manager",
  "calibrated",
  "override",
] as const;
export type FinalRatingStage = (typeof finalRatingStages)[number];
