import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { RunListItem } from "@/modules/ingest/runs-queries";
import { RunOutcome } from "./run-outcome";
import { RunStatusBadge } from "./run-status-badge";
import { useRunFormat } from "./use-run-format";

/** The latest runs, dense: what was imported last and how it went. */
export function RecentRuns({ runs }: { runs: RunListItem[] }) {
  const t = useTranslations("Imports.runs");
  const { dateTime } = useRunFormat();
  return (
    <section
      aria-labelledby="recent-runs"
      className="admin-surface flex flex-col gap-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="recent-runs" className="text-xl">
          {t("recent.title")}
        </h2>
        <Link href="/imports/runs" className="text-sm text-primary underline">
          {t("recent.all")}
        </Link>
      </div>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {runs.map((run) => (
            <li key={run.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <Link
                  href={`/imports/runs/${run.id}`}
                  className="font-medium underline decoration-brand-200 underline-offset-4"
                >
                  {run.entity}
                </Link>
                <RunStatusBadge status={run.status} />
              </div>
              <p className="text-xs text-muted-foreground">
                {dateTime(run.startedAt)} · {run.sourceSystem ?? "—"} ·{" "}
                {t("recent.read", { n: run.counts.read ?? 0 })}
              </p>
              <RunOutcome counts={run.counts} compact />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
