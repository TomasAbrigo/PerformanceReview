import { DomainError } from "@/lib/domain-error";

export type NotificationErrorCode =
  "validation" | "not_found" | "forbidden" | "not_pending";

export class NotificationError extends DomainError<NotificationErrorCode> {}
