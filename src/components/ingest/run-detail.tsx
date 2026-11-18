import { CardCollection } from "@/components/card-collection";
import { cn } from "@/lib/utils";
import { RunOutcome } from "./run-outcome";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { INGEST_COUNT_KEYS, INGEST_EXTRA_COUNT_KEYS } from "@/db/schema/ingest";
import { Link } from "@/i18n/navigation";
import type { RunDetail } from "@/modules/ingest/runs-queries";
import { RunStatusBadge } from "./run-status-badge";
import { useRunFormat } from "./use-run-format";

export function RunDetailView({ run }: { run: RunDetail }) {
  const t = useTranslations("Imports.runs");
  const { dateTime, duration } = useRunFormat();
  const summary: { label: string; value: ReactNode }[] = [
    {
      label: t("detail.id"),
      value: <span className="font-mono">{run.id}</span>,
    },
    {
      label: t("columns.status"),
      value: <RunStatusBadge status={run.status} />,
    },
    { label: t("columns.source"), value: run.sourceSystem ?? "—" },
    { label: t("columns.adapter"), value: run.adapter ?? "—" },
    { label: t("columns.entity"), value: run.entity },
    { label: t("columns.started"), value: dateTime(run.startedAt) },
    { label: t("detail.finished"), value: dateTime(run.finishedAt) },
    {
      label: t("columns.duration"),
      value: duration(run.startedAt, run.finishedAt),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Link href="/imports/runs" className="text-sm underline">
        {t("back")}
      </Link>
      <h1>{t("detail.title")}</h1>

      <dl className="admin-surface grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {summary.map(({ label, value }) => (
          <div key={label} className="flex min-w-0 flex-col gap-2 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
      </dl>

      {run.error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive"
        >
          <h2 className="text-lg">{t("detail.error")}</h2>
          <p className="font-mono text-sm break-words">{run.error}</p>
        </div>
      ) : null}

      <section className="admin-surface flex flex-col gap-4">
        <h2>{t("detail.counts")}</h2>
        <RunOutcome counts={run.counts} rejectsHref="#run-rejects" />
        <div
          role="group"
          aria-label={t("detail.counts")}
          className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8"
        >
          {[
            ...INGEST_COUNT_KEYS,
            ...INGEST_EXTRA_COUNT_KEYS.filter(
              (k) => run.counts[k] !== undefined,
            ),
          ].map((k) => {
            const n = run.counts[k];
            const bad = (k === "rejected" || k === "issues") && (n ?? 0) > 0;
            return (
              <section
                key={k}
                aria-label={t(`columns.${k}`)}
                data-tone={bad ? "risk" : undefined}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border border-border px-3 py-2",
                  bad && "border-status-pending/40 bg-status-pending-bg",
                  !n && "text-muted-foreground",
                )}
              >
                <p className="text-xs">{t(`columns.${k}`)}</p>
                <p className="stat-value !text-2xl tabular-nums">{n ?? "—"}</p>
              </section>
            );
          })}
        </div>
        <p className="text-sm text-muted-foreground">
          {t("detail.rawRecords", { count: run.rawRecordCount })}
        </p>
      </section>

      <section id="run-rejects" className="flex flex-col gap-2">
        <h2>{t("detail.rejects")}</h2>
        {run.rejects.length === 0 ? (
          <p>{t("detail.noRejects")}</p>
        ) : (
          <CardCollection
            role="group"
            aria-label={t("detail.rejects")}
            gridClassName="record-grid"
          >
            {run.rejects.map((r, i) => (
              <article key={i} className="record-card">
                <p className="font-mono text-sm break-all">
                  {r.sourceId ?? t("detail.noSourceId")}
                </p>
                <p className="insight-callout">{r.reason}</p>
              </article>
            ))}
          </CardCollection>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2>{t("detail.params")}</h2>
        {Object.keys(run.params).length === 0 ? (
          <p>{t("detail.noParams")}</p>
        ) : (
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-sm">
            {JSON.stringify(run.params, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
