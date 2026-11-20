import { CardCollection } from "@/components/card-collection";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import {
  CalendarRange,
  ClipboardCheck,
  FileSpreadsheet,
  Fingerprint,
  MessageSquareText,
} from "lucide-react";
import { IconTile, MetricCard } from "@/components/experience";
import { Link } from "@/i18n/navigation";
import type { HistoryImportResult } from "@/modules/import-history/results";
import { CycleDecisionForm, type ResumeOutcome } from "./cycle-decision";

/**
 * What a historical import (a Bamboo performance or feedback report) did,
 * per detected cycle: rows written apart from the ones held for identity or
 * superseded; requests and answers created, updated, unchanged or removed
 * (#132); reviewer mismatches and the comments still to label.
 */
export function HistoryResult({
  result,
  resume,
}: {
  result: HistoryImportResult;
  /** Resumes a run waiting for a decision (server action). */
  resume?: (runId: string, choice: string) => Promise<ResumeOutcome>;
}) {
  const t = useTranslations("ImportHistory");
  type Key = Exclude<
    keyof HistoryImportResult["cycles"][number],
    "cycleId" | "name" | "periodStart" | "periodEnd"
  >;
  const sumOf = (key: Key) => result.cycles.reduce((n, c) => n + c[key], 0);
  const changes = (of: "requests" | "answers", c: Record<Key, number>) =>
    t("changes", {
      created: c[`${of}Created`],
      updated: c[`${of}Updated`],
      unchanged: c[`${of}Unchanged`],
      removed: c[`${of}Removed`],
    });
  const totals = (of: "requests" | "answers") =>
    t("totals.changes", {
      updated: sumOf(`${of}Updated`),
      unchanged: sumOf(`${of}Unchanged`),
      removed: sumOf(`${of}Removed`),
    });
  const pending = sumOf("pendingLabels");

  return (
    <div className="flex flex-col gap-6">
      <Link href="/imports/runs" className="text-sm underline">
        {t("back")}
      </Link>
      <div className="flex flex-col gap-1">
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("summary", { count: result.cycles.length })}
        </p>
      </div>

      {result.status === "needs_decision" && result.decision && resume ? (
        <CycleDecisionForm
          runId={result.runId}
          decision={result.decision}
          resume={resume}
        />
      ) : null}
      {result.decision?.resolved ? (
        <p className="text-sm text-muted-foreground">
          {t("decision.resolved")}
        </p>
      ) : null}

      <div
        role="group"
        aria-label={t("totals.label")}
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <MetricCard
          label={t("totals.rows")}
          value={sumOf("written")}
          note={`${t("totals.rowsNote", {
            rows: sumOf("rows"),
            retained: sumOf("issues"),
            superseded: sumOf("superseded"),
          })} · ${t("totals.cycles", { count: result.cycles.length })}`}
          icon={<FileSpreadsheet className="size-5" />}
        />
        <MetricCard
          label={t("totals.requests")}
          value={sumOf("requestsCreated")}
          note={totals("requests")}
          icon={<ClipboardCheck className="size-5" />}
        />
        <MetricCard
          label={t("totals.answers")}
          value={sumOf("answersCreated")}
          note={totals("answers")}
          icon={<MessageSquareText className="size-5" />}
        />
        <MetricCard
          label={t("totals.issues")}
          value={sumOf("issues")}
          href={sumOf("issues") > 0 ? "/imports/identity" : undefined}
          status={sumOf("issues") > 0 ? "watch" : "good"}
          note={t("totals.mismatches", { n: sumOf("mismatches") })}
          icon={<Fingerprint className="size-5" />}
        />
      </div>
      {pending > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("pendingLabels", { count: pending })}
        </p>
      ) : null}

      <CardCollection
        role="group"
        aria-label={t("cycles")}
        gridClassName="record-grid"
      >
        {result.cycles.map((c) => (
          <article key={c.cycleId} className="record-card">
            <header className="flex items-start gap-3">
              <IconTile>
                <CalendarRange className="size-5" />
              </IconTile>
              <div>
                <h2 className="text-xl">{c.name}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("period", { start: c.periodStart, end: c.periodEnd })}
                </p>
              </div>
            </header>
            <dl className="record-facts">
              {(
                [
                  ["rows", t("rowsOf", { written: c.written, rows: c.rows })],
                  ["participants", c.participantsCreated],
                  ["requests", changes("requests", c)],
                  ["answers", changes("answers", c)],
                  ["superseded", c.superseded],
                  ["mismatches", c.mismatches],
                  ["pendingLabels", c.pendingLabels],
                ] as const
              ).map(([key, value]) => (
                <div key={key}>
                  <dt>{t(`columns.${key}`)}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              <div>
                <dt>{t("columns.issues")}</dt>
                <dd>
                  {c.issues > 0 ? (
                    <Link
                      href="/imports/identity"
                      className="text-destructive underline"
                    >
                      {c.issues}
                    </Link>
                  ) : (
                    0
                  )}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </CardCollection>
      <p className="text-sm text-muted-foreground">{t("mismatchHint")}</p>
      <p className="text-sm text-muted-foreground">{t("supersededHint")}</p>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/imports/runs/${result.runId}`}
          className={buttonVariants({ variant: "outline" })}
        >
          {t("viewRun")}
        </Link>
        <Link
          href="/imports/identity"
          className={buttonVariants({ variant: "outline" })}
        >
          {t("viewQueue")}
        </Link>
      </div>
    </div>
  );
}
