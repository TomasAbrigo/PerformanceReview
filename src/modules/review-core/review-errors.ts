import { DomainError } from "@/lib/domain-error";

export type ReviewErrorCode = "not_found" | "forbidden" | "validation";

/** Errors of reading review data (cycles, requests, answers, dashboards). */
export class ReviewError extends DomainError<ReviewErrorCode> {}
