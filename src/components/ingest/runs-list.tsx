import { CardCollection } from "@/components/card-collection";
import { EmptyState } from "@/components/experience";
import { useTranslations } from "next-intl";
import { ExportCsvLink } from "@/components/data-quality/export-csv-link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Database } from "lucide-react";
import { IconTile } from "@/components/experience";
import { INGEST_COUNT_KEYS } from "@/db/schema/ingest";
import { Link } from "@/i18n/navigation";
import { RUN_STATUSES } from "@/modules/ingest/run-status";
import type {
  RunListFilters,
  RunListItem,
} from "@/modules/ingest/runs-queries";
import { RunOutcome } from "./run-outcome";
import { RunStatusBadge } from "./run-status-badge";
import { useRunFormat } from "./use-run-format";

function FilterSelect({
  name,
  label,
  allLabel,
  value,
  options,
}: {
  name: string;
  label: string;
  allLabel: string;
  value: string | undefined;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="control-label">
      {label}
      <select name={name} defaultValue={value ?? ""} className="control">
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RunsList({
  runs,
  filters,
  entities,
  sources,
  nextHref,
}: {
  runs: RunListItem[];
  filters: RunListFilters;
  /** Entities that have runs, for the filter. */
  entities: string[];
  sources: string[];
  /** Link to the next (older) page, if there is one. */
  nextHref: string | null;
}) {
  const t = useTranslations("Imports.runs");
  const tHome = useTranslations("Home");
  const { dateTime, duration } = useRunFormat();
  const hasFilters = Boolean(
    filters.source || filters.entity || filters.status,
  );
  const same = (v: string) => ({ value: v, label: v });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        kicker={tHome("groups.data")}
        title={t("title")}
        description={t("description")}
        actions={
          <ExportCsvLink
            file="ingest-runs"
            params={{
              source: filters.source,
              entity: filters.entity,
              status: filters.status,
            }}
          />
        }
      />

      <form
        role="search"
        method="get"
        aria-label={t("filters.label")}
        className="filter-toolbar flex flex-wrap items-end gap-3"
      >
        <FilterSelect
          name="source"
          label={t("filters.source")}
          allLabel={t("filters.all")}
          value={filters.source}
          options={sources.map(same)}
        />
        <FilterSelect
          name="entity"
          label={t("filters.entity")}
          allLabel={t("filters.all")}
          value={filters.entity}
          options={entities.map(same)}
        />
        <FilterSelect
          name="status"
          label={t("filters.status")}
          allLabel={t("filters.all")}
          value={filters.status}
          options={RUN_STATUSES.map((s) => ({
            value: s,
            label: t(`status.${s}`),
          }))}
        />
        <Button type="submit">{t("filters.apply")}</Button>
        <Link href="/imports/runs" className="py-1.5 text-sm hover:underline">
          {t("filters.clear")}
        </Link>
      </form>

      {runs.length === 0 ? (
        <EmptyState>{hasFilters ? t("emptyFiltered") : t("empty")}</EmptyState>
      ) : (
        // The page is already paged (25): every run of it is shown.
        <CardCollection gridClassName="record-grid" initialCount={runs.length}>
          {runs.map((run) => (
            <article key={run.id} className="record-card">
              <header className="flex items-center justify-between gap-3">
                <IconTile>
                  <Database className="size-5" />
                </IconTile>
                <RunStatusBadge status={run.status} />
              </header>
              <h2 className="text-xl">
                <Link
                  href={`/imports/runs/${run.id}`}
                  className="underline decoration-brand-200 underline-offset-4"
                >
                  {dateTime(run.startedAt)}
                </Link>
              </h2>
              <p className="text-xs text-muted-foreground">
                {run.sourceSystem ?? "—"} · {run.entity} · {run.adapter ?? "—"}
              </p>
              <RunOutcome counts={run.counts} compact />
              <dl className="record-facts">
                {INGEST_COUNT_KEYS.map((k) => (
                  <div key={k}>
                    <dt>{t(`columns.${k}`)}</dt>
                    <dd>
                      <span className="stat-value-sm">
                        {run.counts[k] ?? "—"}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap justify-between gap-3 border-t pt-4 text-xs text-muted-foreground">
                <span>
                  {t("columns.log")}: {run.issues}
                </span>
                <span>
                  {t("columns.duration")}:{" "}
                  {duration(run.startedAt, run.finishedAt)}
                </span>
              </div>
            </article>
          ))}
        </CardCollection>
      )}

      {nextHref ? (
        <nav aria-label={t("pagination.label")}>
          <Link href={nextHref} className="text-sm underline">
            {t("pagination.next")}
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
