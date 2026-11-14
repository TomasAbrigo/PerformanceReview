"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { NotificationItem } from "@/modules/notifications";
import { notificationHref } from "@/modules/notifications/href";
import { useNotificationText } from "./notification-text";

/** The latest unread notifications, inline (the /me page); nothing when there are none. */
export function NotificationsPreview({
  items,
  unread,
}: {
  items: NotificationItem[];
  /** Total unread, which may be more than the items shown. */
  unread: number;
}) {
  const t = useTranslations("Notifications");
  const text = useNotificationText();
  const headingId = useId();
  if (items.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-lg font-medium">
        {t("me.title")}
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((n) => (
          <li
            key={n.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 p-3"
          >
            <span>{text(n)}</span>
            <Link
              href={notificationHref(n)}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              {t("open")}
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/inbox" className="self-start text-sm underline">
        {t("me.viewAll", { count: unread })}
      </Link>
    </section>
  );
}
