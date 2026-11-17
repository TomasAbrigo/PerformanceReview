// Drizzle-free constants shared by the schema, the domain and client components.

export const questionKinds = ["text", "rating", "single_choice"] as const;
export type QuestionKind = (typeof questionKinds)[number];

export const relationships = ["self", "manager", "peer", "upward"] as const;
export type Relationship = (typeof relationships)[number];

/**
 * Special meaning of a question, besides its kind. `goals_rating` is the
 * single rating for all of the participant's goals and `goals_comment` its
 * comment; `overall_rating` is the manager's overall performance rating, the
 * one the final rating starts from. `retention` and `engagement` are the
 * manager's closed Likert 1-5 questions (Bamboo's manager Q1/Q2): ratings,
 * manager only, never visible to the reviewee. Analytics use the roles to tell them
 * apart; the goals ones never feed the final rating or the calibration.
 */
export const questionRoles = [
  "goals_rating",
  "goals_comment",
  "overall_rating",
  "retention",
  "engagement",
] as const;
export type QuestionRole = (typeof questionRoles)[number];

/**
 * What an open question is about, for the qualitative analysis: Bamboo's two
 * standard questions (strengths, improvement) and the three custom ones.
 */
export const questionDimensions = [
  "strengths",
  "improvement",
  "custom_1",
  "custom_2",
  "custom_3",
] as const;
export type QuestionDimension = (typeof questionDimensions)[number];
