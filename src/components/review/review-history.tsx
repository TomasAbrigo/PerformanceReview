"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useLocalized } from "@/components/templates/shared";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { HistoryItem } from "@/modules/review-core/history";
import { ReadOnlyAnswers } from "./manager-review-form";
import type { SelfReviewData } from "./self-review-form";

export type HistoryItemView = Omit<HistoryItem, "self" | "manager"> & {
  self: SelfReviewData | null;
  manager: SelfReviewData | null;
};

/**
 * A person's finalized or shared cycles (/people/[id]/reviews): per cycle the
 * manager and job of that moment (snapshot), the current rating, whether it
 * was shared and acknowledged, and the answers the viewer may read.
 */
export function ReviewHistory({
  personName,
  items,
}: {
  personName: string;
  items: HistoryItemView[];
}) {
  const t = useTranslations("History");
  const format = useFormatter();
  const localized = useLocalized();
  const isoDate = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
  const day = (d: Date) =>
    format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        {t("title", { name: personName })}
      </h1>
      {items.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.participantId}>
              <article
                aria-label={item.cycleName}
                className="flex flex-col gap-3 rounded-md border p-4"
              >
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <h2 className="text-lg font-medium">{item.cycleName}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t("period", {
                        start: isoDate(item.periodStart),
                        end: isoDate(item.periodEnd),
                      })}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {t(`status.${item.cycleStatus}`)}
                  </Badge>
                </header>
                <div className="flex flex-col gap-1 text-sm">
                  <p>
                    {item.managerName
                      ? t("manager", { name: item.managerName })
                      : t("noManager")}
                  </p>
                  {item.jobTitle || item.department ? (
                    <p>
                      {t("job", {
                        title: item.jobTitle ?? "—",
                        department: item.department ?? "—",
                      })}
                    </p>
                  ) : null}
                  <p>
                    {item.sharedAt
                      ? t("shared", { date: day(item.sharedAt) })
                      : t("notShared")}
                  </p>
                  <p>
                    {item.acknowledgedAt
                      ? t("acknowledged", { date: day(item.acknowledgedAt) })
                      : t("notAcknowledged")}
                  </p>
                </div>
                <p className="font-medium">
                  <span className="sr-only">{t("rating")}: </span>
                  {item.rating
                    ? t("ratingValue", {
                        label: localized(item.rating.label),
                        percent: `${Math.round(item.rating.normalized * 100)}%`,
                      })
                    : t("noRating")}
                </p>
                {item.self || item.manager ? (
                  <details className="flex flex-col gap-3">
                    <summary className="cursor-pointer font-medium">
                      {t("showAnswers")}
                    </summary>
                    <div className="mt-3 flex flex-col gap-4">
                      {item.self ? (
                        <section className="flex flex-col gap-2">
                          <h3 className="font-medium">{t("selfAnswers")}</h3>
                          <ReadOnlyAnswers review={item.self} />
                        </section>
                      ) : null}
                      {item.manager ? (
                        <section className="flex flex-col gap-2">
                          <h3 className="font-medium">{t("managerAnswers")}</h3>
                          <ReadOnlyAnswers review={item.manager} />
                        </section>
                      ) : null}
                    </div>
                  </details>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("noAnswers")}
                  </p>
                )}
                {item.canCompare ? (
                  <Link
                    href={`/cycles/${item.cycleId}/compare/${item.participantId}`}
                    className={buttonVariants({
                      size: "sm",
                      variant: "outline",
                    })}
                  >
                    {t("compare")}
                  </Link>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
