import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import type { RunDetail } from "@/modules/ingest/runs-queries";
import { RunStatusBadge } from "./run-status-badge";
import { COUNT_KEYS } from "./runs-list";
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
    { label: t("columns.entity"), value: run.entity ?? "—" },
    { label: t("columns.started"), value: dateTime(run.startedAt) },
    { label: t("detail.finished"), value: dateTime(run.finishedAt) },
    {
      label: t("columns.duration"),
      value: duration(run.startedAt, run.finishedAt),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Link href="/imports/runs" className="text-sm hover:underline">
        {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("detail.title")}</h1>

      <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-2">
        {summary.map(({ label, value }) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {run.error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive"
        >
          <h2 className="font-medium">{t("detail.error")}</h2>
          <p className="font-mono text-sm break-words">{run.error}</p>
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">{t("detail.counts")}</h2>
        <Table aria-label={t("detail.counts")} className="max-w-sm">
          <TableHeader>
            <TableRow>
              <TableHead>{t("detail.metric")}</TableHead>
              <TableHead className="text-right">{t("detail.count")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {COUNT_KEYS.map((k) => (
              <TableRow key={k}>
                <TableHead scope="row" className="font-normal">
                  {t(`columns.${k}`)}
                </TableHead>
                <TableCell className="text-right tabular-nums">
                  {run.counts[k] ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-sm text-muted-foreground">
          {t("detail.rawRecords", { count: run.rawRecordCount })}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">{t("detail.rejects")}</h2>
        {run.rejects.length === 0 ? (
          <p>{t("detail.noRejects")}</p>
        ) : (
          <Table aria-label={t("detail.rejects")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("detail.rejectSourceId")}</TableHead>
                <TableHead>{t("detail.rejectReason")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.rejects.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono">
                    {r.sourceId ?? (
                      <span className="text-muted-foreground">
                        {t("detail.noSourceId")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {r.reason}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">{t("detail.params")}</h2>
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
