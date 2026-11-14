// Drizzle-free constants shared by the schema, the domain and client components.

export const questionKinds = ["text", "rating", "single_choice"] as const;
export type QuestionKind = (typeof questionKinds)[number];

export const relationships = ["self", "manager", "peer", "upward"] as const;
export type Relationship = (typeof relationships)[number];

/**
 * Special meaning of a question, besides its kind. `goals_rating` is the
 * single rating for all of the participant's goals and `goals_comment` its
 * comment. Analytics use it to tell the goals rating apart from the overall
 * rating, and neither ever feeds the final rating or the calibration.
 */
export const questionRoles = ["goals_rating", "goals_comment"] as const;
export type QuestionRole = (typeof questionRoles)[number];
