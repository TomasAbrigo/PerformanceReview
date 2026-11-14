import { useFormatter, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
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
        <p>{t(history ? "empty.history" : "empty.open")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.sourceId")}</TableHead>
              <TableHead>{t("columns.reason")}</TableHead>
              <TableHead>
                {t(history ? "columns.resolution" : "columns.candidates")}
              </TableHead>
              <TableHead>
                {t(history ? "columns.resolved" : "columns.detected")}
              </TableHead>
              {history ? null : (
                <TableHead>
                  <span className="sr-only">{t("review")}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.map((issue) => (
              <TableRow key={issue.id}>
                <TableCell>
                  <Link
                    href={`/imports/identity/${issue.id}`}
                    className="font-medium hover:underline"
                  >
                    {issue.summary.displayName ?? t("unnamed")}
                  </Link>
                  {issue.summary.role ? (
                    <span className="ml-2 text-sm text-muted-foreground">
                      ({t(`roles.${issue.summary.role as "employee"}`)})
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="font-mono">{issue.sourceId}</TableCell>
                <TableCell>
                  <ReasonBadge reason={issue.reason} />
                </TableCell>
                <TableCell>
                  {history
                    ? issue.resolution
                      ? t(`resolution.short.${issue.resolution.action}`)
                      : "—"
                    : t("candidatesCount", { count: issue.candidateCount })}
                </TableCell>
                <TableCell>
                  {fmt(history ? issue.resolvedAt : issue.createdAt)}
                </TableCell>
                {history ? null : (
                  <TableCell className="text-right">
                    <Link
                      href={`/imports/identity/${issue.id}`}
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      {t("review")}
                    </Link>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
