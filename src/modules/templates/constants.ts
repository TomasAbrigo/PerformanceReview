// Drizzle-free constants shared by the schema, the domain and client components.

export const questionKinds = ["text", "rating", "single_choice"] as const;
export type QuestionKind = (typeof questionKinds)[number];

export const relationships = ["self", "manager", "peer", "upward"] as const;
export type Relationship = (typeof relationships)[number];
