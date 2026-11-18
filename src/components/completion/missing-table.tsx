import { CardCollection } from "@/components/card-collection";
import { UserRound, MessageSquare } from "lucide-react";
import { IconTile, EmptyState } from "@/components/experience";
import { useTranslations } from "next-intl";
import {
  isMissing,
  type MissingPerson,
  type SideStatus,
} from "@/modules/analytics/completion/types";

const GLYPH: Record<SideStatus, string> = {
  submitted: "✓",
  in_progress: "◐",
  not_started: "○",
  not_applicable: "–",
};

/** A status as a chip: a glyph and the word, never color alone. */
export function StatusChip({ status }: { status: SideStatus }) {
  const t = useTranslations("Completion.missing.statuses");
  const missing = isMissing(status);
  return (
    <span
      data-status={status}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${
        missing
          ? "bg-status-progress-bg font-medium text-foreground"
          : status === "submitted"
            ? "bg-status-done-bg text-foreground"
            : "bg-brand-fog text-muted-foreground"
      }`}
    >
      <span aria-hidden="true">{GLYPH[status]}</span>
      {t(status)}
    </span>
  );
}

/**
 * "Quién falta": one row per person with a side of their assessment still to
 * be submitted, with the area and manager of the chosen hierarchy. The
 * follow-up notes of the report are not shown, only that there are some.
 */
export function MissingTable({ rows }: { rows: MissingPerson[] }) {
  const t = useTranslations("Completion.missing");
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm" role="status">
        {t("count", { n: rows.length })}
      </p>
      {rows.length === 0 ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        <CardCollection
          gridClassName="record-grid"
          role="group"
          aria-label={t("title")}
        >
          {rows.map((r) => (
            <article
              key={r.participantId}
              className="record-card"
              aria-label={r.name}
            >
              <header className="flex items-center gap-3">
                <IconTile>
                  <UserRound className="size-5" />
                </IconTile>
                <div>
                  <h3 className="text-xl">{r.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {r.department ?? t("none")}
                  </p>
                </div>
              </header>
              <p className="text-sm text-muted-foreground">
                {t("columns.manager")}: {r.managerName ?? t("none")}
              </p>
              <dl className="record-facts">
                <div>
                  <dt>{t("columns.self")}</dt>
                  <dd>
                    <StatusChip status={r.selfStatus} />
                  </dd>
                </div>
                <div>
                  <dt>{t("columns.managerReview")}</dt>
                  <dd>
                    <StatusChip status={r.managerStatus} />
                  </dd>
                </div>
              </dl>
              {r.hasFollowUpNotes ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MessageSquare className="size-4" aria-hidden="true" />
                  {t("notes")}
                </p>
              ) : null}
            </article>
          ))}
        </CardCollection>
      )}
    </div>
  );
}
