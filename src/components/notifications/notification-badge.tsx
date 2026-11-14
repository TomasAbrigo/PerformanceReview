import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** Header bell: links to the inbox, with the unread count when there is one. */
export function NotificationBadge({ count }: { count: number }) {
  const t = useTranslations("Notifications");
  return (
    <Link
      href="/inbox"
      aria-label={t("badge.label", { count })}
      className="relative inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
    >
      <Bell aria-hidden="true" className="size-4" />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground"
        >
          {count > 99 ? t("badge.capped") : count}
        </span>
      ) : null}
    </Link>
  );
}
