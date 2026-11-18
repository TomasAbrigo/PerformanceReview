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
        <div className="goal-grid">
          {issues.map((issue) => (
            <article key={issue.id} className="goal-card">
              <div className="flex items-center justify-between gap-3">
                <IconTile>
                  <UserRound />
                </IconTile>
                <ReasonBadge reason={issue.reason} />
              </div>
              <h2 className="text-xl">
                <Link
                  className="card-link"
                  href={`/imports/identity/${issue.id}`}
                >
                  {issue.summary.displayName ?? t("unnamed")}
                </Link>
              </h2>
              {issue.summary.role ? (
                <p className="text-sm text-muted-foreground">
                  {t(`roles.${issue.summary.role as "employee"}`)}
                </p>
              ) : null}
              <p className="text-xs break-all text-muted-foreground">
                {t("columns.sourceId")}: {issue.sourceId}
              </p>
              <p className="rounded-lg bg-brand-fog p-3 text-sm">
                {t("candidatesCount", { count: issue.candidateCount })}
              </p>
              <div className="mt-auto flex items-center justify-between border-t pt-4 text-sm">
                <span>{fmt(issue.createdAt)}</span>
                <span className="flex items-center gap-2 text-primary">
                  {t("review")}
                  <ArrowUpRight className="size-4" />
                </span>
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
