// Drizzle-free constants shared by the schema, the domain and client components.

export const requestStatuses = ["draft", "submitted", "declined"] as const;
export type RequestStatus = (typeof requestStatuses)[number];

export const reviewActions = ["unlock"] as const;
export type ReviewAction = (typeof reviewActions)[number];
