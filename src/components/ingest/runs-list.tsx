import { useTranslations } from "next-intl";
import { ExportCsvLink } from "@/components/data-quality/export-csv-link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { INGEST_COUNT_KEYS } from "@/db/schema/ingest";
import { Link } from "@/i18n/navigation";
import { RUN_STATUSES } from "@/modules/ingest/run-status";
import type {
  RunListFilters,
  RunListItem,
} from "@/modules/ingest/runs-queries";
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
        className="flex flex-wrap items-end gap-3"
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
        <p>{hasFilters ? t("emptyFiltered") : t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.started")}</TableHead>
              <TableHead>{t("columns.source")}</TableHead>
              <TableHead>{t("columns.adapter")}</TableHead>
              <TableHead>{t("columns.entity")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              {INGEST_COUNT_KEYS.map((k) => (
                <TableHead key={k} className="text-right">
                  {t(`columns.${k}`)}
                </TableHead>
              ))}
              <TableHead className="text-right">{t("columns.log")}</TableHead>
              <TableHead className="text-right">
                {t("columns.duration")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <Link
                    href={`/imports/runs/${run.id}`}
                    className="hover:underline"
                  >
                    {dateTime(run.startedAt)}
                  </Link>
                </TableCell>
                <TableCell>{run.sourceSystem ?? "—"}</TableCell>
                <TableCell>{run.adapter ?? "—"}</TableCell>
                <TableCell>{run.entity}</TableCell>
                <TableCell>
                  <RunStatusBadge status={run.status} />
                </TableCell>
                {INGEST_COUNT_KEYS.map((k) => (
                  <TableCell key={k} className="text-right tabular-nums">
                    {run.counts[k] ?? "—"}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">
                  {run.issues}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {duration(run.startedAt, run.finishedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
