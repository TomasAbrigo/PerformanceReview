"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { Link } from "@/i18n/navigation";
import type { NotificationItem } from "@/modules/notifications";
import { notificationHref } from "@/modules/notifications/href";
import { useNotificationText } from "./notification-text";

/** The actor's inbox: unread first, mark one or all read, links to the task. */
export function InboxView({
  items,
  nextCursor,
  isFirstPage = true,
  hasPerson,
  markRead,
  markAllRead,
}: {
  items: NotificationItem[];
  nextCursor: string | null;
  isFirstPage?: boolean;
  hasPerson: boolean;
  markRead: (ids: string[]) => Promise<ActionResult>;
  markAllRead: () => Promise<ActionResult>;
}) {
  const t = useTranslations("Notifications");
  const text = useNotificationText();
  const format = useFormatter();
  const unreadId = useId();
  const readId = useId();
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const unread = items.filter((n) => n.readAt === null);
  const read = items.filter((n) => n.readAt !== null);

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await action();
      setFailed(!result.ok);
    });
  }

  function list(rows: NotificationItem[]) {
    return (
      <ul className="flex flex-col gap-2">
        {rows.map((n) => {
          const isUnread = n.readAt === null;
          return (
            <li
              key={n.id}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-4 ${
                isUnread ? "border-primary/40 bg-primary/5" : ""
              }`}
            >
              <div className="flex flex-col">
                <span className={isUnread ? "font-medium" : undefined}>
                  {text(n)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {format.dateTime(n.createdAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={notificationHref(n)}
                  className={buttonVariants({
                    size: "sm",
                    variant: isUnread ? "default" : "outline",
                  })}
                >
                  {t("open")}
                </Link>
                {isUnread ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run(() => markRead([n.id]))}
                  >
                    {t("markRead")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {unread.length > 0 ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => run(markAllRead)}
          >
            {t("markAllRead")}
          </Button>
        ) : null}
      </div>
      {failed ? (
        <p role="alert" className="text-destructive">
          {t("error")}
        </p>
      ) : null}
      {!hasPerson ? (
        <p className="text-muted-foreground">{t("noPerson")}</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          {unread.length > 0 ? (
            <section aria-labelledby={unreadId} className="flex flex-col gap-2">
              <h2 id={unreadId} className="text-lg font-medium">
                {t("unreadHeading")}
              </h2>
              {list(unread)}
            </section>
          ) : null}
          {read.length > 0 ? (
            <section aria-labelledby={readId} className="flex flex-col gap-2">
              <h2 id={readId} className="text-lg font-medium">
                {t("readHeading")}
              </h2>
              {list(read)}
            </section>
          ) : null}
        </>
      )}
      <div className="flex gap-4">
        {!isFirstPage ? (
          <Link href="/inbox" className="underline">
            {t("backToStart")}
          </Link>
        ) : null}
        {nextCursor ? (
          <Link href={`/inbox?cursor=${nextCursor}`} className="underline">
            {t("older")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
