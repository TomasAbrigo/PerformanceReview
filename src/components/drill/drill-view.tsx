import { Download, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { CardCollection } from "@/components/card-collection";
import { Link } from "@/i18n/navigation";
import type { DrillPerson, DrillResult } from "@/modules/insights/drill";

const STATUS_FACTS = new Set(["selfStatus", "managerStatus"]);

/** RFC 4180: quote every cell, double the quotes. */
const csvOf = (rows: (string | number | null)[][]) =>
  rows
    .map((r) =>
      r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","),
    )
    .join("\r\n");

/**
 * The records behind a mark, inside the drill sheet: how many, a breakdown
 * (by area or sentiment), then the people or comments with a link to each
 * one's detail, a CSV of what is listed and a link to the full view. For
 * direction only the masked counts: `result.people` and `.comments` are null.
 */
export function DrillView({ result }: { result: DrillResult }) {
  const t = useTranslations("Drill");
  const ts = useTranslations("Qualitative.sentiment");
  const tst = useTranslations("Completion.missing.statuses");
  const groupLabel = (key: string | null, others: boolean) =>
    others
      ? t("others")
      : key === null
        ? t("none")
        : result.breakdownBy === "sentiment"
          ? ts(key as "positive")
          : key;
  const factValue = (f: DrillPerson["facts"][number]) =>
    STATUS_FACTS.has(f.key) ? tst(String(f.value) as "submitted") : f.value;
  const max = Math.max(1, ...result.breakdown.map((g) => g.n));
  const csv = result.people
    ? csvOf([
        [
          t("csv.name"),
          t("csv.department"),
          t("csv.manager"),
          ...(result.people[0]?.facts.map((f) => t(`fact.${f.key}`)) ?? []),
        ],
        ...result.people.map((p) => [
          p.name,
          p.department,
          p.managerName,
          ...p.facts.map(factValue),
        ]),
      ])
    : result.comments
      ? csvOf([
          [
            t("csv.name"),
            t("csv.dimension"),
            t("csv.sentiment"),
            t("csv.text"),
          ],
          ...result.comments.map((c) => [
            c.personName,
            c.dimension,
            ts(c.sentiment),
            c.text,
          ]),
        ])
      : csvOf([
          [t("csv.group"), t("csv.count")],
          ...result.breakdown.map((g) => [groupLabel(g.key, g.others), g.n]),
        ]);
  return (
    <>
      <p className="flex items-baseline gap-3" data-testid="drill-total">
        <span className="stat-value">
          {result.total === null ? "–" : result.total}
        </span>
        <span className="text-sm text-muted-foreground">
          {result.total === null
            ? t("hidden", { min: result.minGroupSize ?? 0 })
            : t(`unit.${result.unit}`, { n: result.total })}
        </span>
      </p>
      {result.minGroupSize !== null ? (
        <p className="insight-callout">
          {t("aggregatesOnly", { min: result.minGroupSize })}
        </p>
      ) : null}
      {result.breakdown.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="drill-by">
          <h3 id="drill-by" className="kicker text-muted-foreground">
            {t(`by.${result.breakdownBy}`)}
          </h3>
          <ul className="flex flex-col gap-1.5" data-testid="drill-breakdown">
            {result.breakdown.map((g) => (
              <li
                key={`${g.key}-${g.others}`}
                className="grid grid-cols-[minmax(6rem,12rem)_1fr_2.5rem] items-center gap-3 text-sm"
              >
                <span className="truncate">{groupLabel(g.key, g.others)}</span>
                <span className="h-2 rounded-sm bg-brand-200/50">
                  <span
                    className="block h-full rounded-sm bg-chart-seq"
                    style={{ width: `${(g.n / max) * 100}%` }}
                  />
                </span>
                <span className="text-right tabular-nums">{g.n}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {result.people ? (
        result.people.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <CardCollection gridClassName="dense-list" initialCount={20}>
            {result.people.map((p) => (
              <article
                key={p.personId}
                className="dense-row"
                aria-label={p.name}
                data-testid="drill-person"
              >
                <div className="dense-name">
                  {p.href ? (
                    <Link href={p.href} className="font-medium">
                      {p.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{p.name}</span>
                  )}
                  <small>
                    {p.department ?? t("none")} · {t("manager")}:{" "}
                    {p.managerName ?? t("none")}
                  </small>
                </div>
                <dl className="dense-facts">
                  {p.facts.map((f) => (
                    <div key={f.key}>
                      <dt>{t(`fact.${f.key}`)}</dt>
                      <dd>{factValue(f)}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </CardCollection>
        )
      ) : null}
      {result.truncated && result.comments ? (
        <p className="text-sm text-muted-foreground">
          {t("truncated", { n: result.comments.length })}
        </p>
      ) : null}
      {result.comments ? (
        result.comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {result.comments.map((c) => (
              <li
                key={c.answerId}
                className="rounded-lg border border-border/70 bg-card p-4"
                data-testid="drill-comment"
              >
                <blockquote className="text-sm leading-relaxed">
                  “{c.text}”
                </blockquote>
                <p className="mt-2 text-xs text-muted-foreground">
                  {c.personName} · {ts(c.sentiment)}
                </p>
              </li>
            ))}
          </ul>
        )
      ) : null}
      <div className="flex flex-wrap gap-3">
        <a
          className="button-outline"
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${csv}`)}`}
          download={`${result.drill.kind}.csv`}
        >
          <Download className="mr-2 size-4" aria-hidden="true" />
          {t("csv.download")}
        </a>
        {result.moreHref ? (
          <Link className="button-outline" href={result.moreHref}>
            <ExternalLink className="mr-2 size-4" aria-hidden="true" />
            {t("more")}
          </Link>
        ) : null}
      </div>
    </>
  );
}
