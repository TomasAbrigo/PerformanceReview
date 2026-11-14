"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { NotificationItem } from "@/modules/notifications";

/**
 * Renders a notification's text in the reader's locale from its kind and
 * payload (`Notifications.messages.<kind>`); the text itself is never stored.
 */
export function useNotificationText() {
  const t = useTranslations("Notifications");
  const tStatus = useTranslations("Cycles.status");
  const format = useFormatter();
  // An ISO date (YYYY-MM-DD) shown as is, not shifted by the time zone.
  const isoDate = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });

  return ({ kind, payload }: Pick<NotificationItem, "kind" | "payload">) =>
    t(`messages.${kind}`, {
      cycle: payload.cycleName ?? "",
      relationship: payload.relationship ?? "other",
      participant: payload.participantName ?? "",
      daysLeft: payload.daysLeft ?? 0,
      hasDueDate: payload.dueDate ? "yes" : "no",
      dueDate: payload.dueDate ? isoDate(payload.dueDate) : "",
      hasSender: payload.senderName ? "yes" : "no",
      sender: payload.senderName ?? t("peopleTeam"),
      launched: payload.fromStatus === "draft" ? "yes" : "no",
      from: payload.fromStatus ? tStatus(payload.fromStatus) : "",
      to: payload.toStatus ? tStatus(payload.toStatus) : "",
    });
}
