import { CardCollection } from "@/components/card-collection";
import { IconTile, EmptyState } from "@/components/experience";
import { UserRound, ArrowUpRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";

import { Link } from "@/i18n/navigation";
import type { IssueListItem } from "@/modules/identity";
import { ReasonBadge } from "./reason-badge";

export type QueueTab = "open" | "history";

export function IdentityQueue({
  issues,
  tab,
  openCount,
  nextCursor = null,
  paged = false,
}: {
  issues: IssueListItem[];
  tab: QueueTab;
  openCount: number;
  /** Cursor of the next (older) page of the history, if there is one. */
  nextCursor?: string | null;
  /** This is not the first page of the history. */
  paged?: boolean;
}) {
  const t = useTranslations("Identity");
  const format = useFormatter();
  const fmt = (d: Date | null) =>
    d ? format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" }) : "—";
  const history = tab === "history";

  const tabs = [
    {
      id: "open",
      href: "/imports/identity",
      label: t("tabs.open", { count: openCount }),
    },
    {
      id: "history",
      href: "/imports/identity?tab=history",
      label: t("tabs.history"),
    },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <nav aria-label={t("tabs.label")} className="flex gap-2 border-b pb-3">
        {tabs.map((x) => (
          <Link
            key={x.id}
            href={x.href}
            aria-current={x.id === tab ? "page" : undefined}
            className={buttonVariants({
              variant: x.id === tab ? "secondary" : "ghost",
              size: "sm",
            })}
          >
            {x.label}
          </Link>
        ))}
      </nav>
      {issues.length === 0 ? (
        <EmptyState>{t(history ? "empty.history" : "empty.open")}</EmptyState>
      ) : !history ? (
        <div
          className="dense-list"
          role="group"
          aria-label={t("tabs.open", { count: openCount })}
        >
          {issues.map((issue) => (
            <article
              key={issue.id}
              className="dense-row grid-cols-1 md:!grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <div className="dense-name">
                <h2 className="text-base font-medium">
                  <Link href={`/imports/identity/${issue.id}`}>
                    {issue.summary.displayName ?? t("unnamed")}
                  </Link>
                </h2>
                <small className="break-all">
                  {issue.summary.role
                    ? `${t(`roles.${issue.summary.role as "employee"}`)} · `
                    : ""}
                  {t("columns.sourceId")}: {issue.sourceId}
                </small>
              </div>
              <div>
                <ReasonBadge reason={issue.reason} />
              </div>
              <p
                className={
                  issue.candidateCount > 0
                    ? "text-sm"
                    : "text-sm text-muted-foreground"
                }
              >
                {t("candidatesCount", { count: issue.candidateCount })}
              </p>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-muted-foreground">
                  {fmt(issue.createdAt)}
                </span>
                <Link
                  href={`/imports/identity/${issue.id}`}
                  className="flex items-center gap-1 text-primary"
                  aria-hidden="true"
                  tabIndex={-1}
                >
                  {t("review")}
                  <ArrowUpRight className="size-4" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <CardCollection gridClassName="record-grid">
          {issues.map((issue) => (
            <article
              key={issue.id}
              className="record-card"
              aria-label={issue.summary.displayName ?? t("unnamed")}
            >
              <header className="flex items-center justify-between gap-3">
                <IconTile>
                  <UserRound />
                </IconTile>
                <ReasonBadge reason={issue.reason} />
              </header>
              <h2 className="text-xl">
                <Link
                  href={`/imports/identity/${issue.id}`}
                  className="underline decoration-brand-200 underline-offset-4"
                >
                  {issue.summary.displayName ?? t("unnamed")}
                </Link>
              </h2>
              {issue.summary.role ? (
                <p className="text-xs text-muted-foreground">
                  {t(`roles.${issue.summary.role as "employee"}`)}
                </p>
              ) : null}
              <dl className="record-facts">
                <div>
                  <dt>{t("columns.sourceId")}</dt>
                  <dd>{issue.sourceId}</dd>
                </div>
                <div>
                  <dt>{t("columns.resolved")}</dt>
                  <dd>{fmt(issue.resolvedAt)}</dd>
                </div>
              </dl>
              <p className="insight-callout">
                {issue.resolution
                  ? t(`resolution.short.${issue.resolution.action}`)
                  : "—"}
              </p>
            </article>
          ))}
        </CardCollection>
      )}
      {history && (paged || nextCursor) ? (
        <nav aria-label={t("pagination.label")} className="flex gap-2">
          {paged ? (
            <Link
              href="/imports/identity?tab=history"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {t("pagination.newest")}
            </Link>
          ) : null}
          {nextCursor ? (
            <Link
              href={`/imports/identity?tab=history&cursor=${encodeURIComponent(nextCursor)}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {t("pagination.older")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
