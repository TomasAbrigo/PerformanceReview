import { CardCollection } from "@/components/card-collection";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { CalendarRange } from "lucide-react";
import { IconTile } from "@/components/experience";
import { Link } from "@/i18n/navigation";
import type { HistoryImportResult } from "@/modules/import-history/results";
import { CycleDecisionForm, type ResumeOutcome } from "./cycle-decision";

/**
 * What a historical import (a Bamboo performance or feedback report) did,
 * per detected cycle: participants, requests and answers created or left
 * unchanged, rows sent to the identity queue and reviewer mismatches.
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
  const both = (created: number, unchanged: number) =>
    t("createdUnchanged", { created, unchanged });

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
                  ["rows", c.rows],
                  ["participants", c.participantsCreated],
                  ["requests", both(c.requestsCreated, c.requestsUnchanged)],
                  ["answers", both(c.answersCreated, c.answersUnchanged)],
                  ["mismatches", c.mismatches],
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
