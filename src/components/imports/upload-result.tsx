"use client";

import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import type { IngestReject } from "@/db/schema";
import { Link } from "@/i18n/navigation";
import type { ImportResult } from "@/modules/lake/upload-shared";

type Success = Extract<ImportResult, { ok: true }>;

/**
 * What the import did. Links to the run's page (`/imports/runs/<id>`); the
 * counts are shown here too, so the result is useful on its own.
 */
export function UploadResult({
  result,
  onReset,
}: {
  result: Success;
  onReset: () => void;
}) {
  const t = useTranslations("Upload.result");
  const { counts, rejects, runId } = result;
  // The reason on the run is English, for logs: the UI words the cause itself.
  const rejectText = (reject: IngestReject) =>
    reject.code === "empty_key" && reject.column
      ? t("rejectReasons.empty_key", {
          column: reject.column,
          row: describeValues(reject.values ?? {}),
        })
      : t("rejectReasons.other");
  const figures = [
    ["read", t("read"), counts.read],
    ["inserted", t("inserted"), counts.inserted],
    ["unchanged", t("unchanged"), counts.unchanged],
    ["rejected", t("rejected"), counts.rejected],
  ] as const;

  return (
    <section aria-labelledby="upload-result" className="flex flex-col gap-4">
      <h2 id="upload-result" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <dl className="grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
        {figures.map(([key, label, value]) => (
          <div
            key={key}
            data-count={key}
            className="rounded-lg border p-3 text-center"
          >
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {counts.inserted === 0 && counts.unchanged > 0 ? (
        <p className="text-sm text-muted-foreground">{t("noNew")}</p>
      ) : null}
      {rejects.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t("rejects")}</h3>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {rejects.map((reject, index) => (
              <li key={index}>{rejectText(reject)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/imports/runs/${runId}`}
          className={buttonVariants({ variant: "default" })}
        >
          {t("viewRun")}
        </Link>
        <Button variant="outline" onClick={onReset}>
          {t("another")}
        </Button>
      </div>
    </section>
  );
}

/** `Employee Name="Ana", Goal=∅`: the key values of a row, empty ones marked. */
function describeValues(values: Record<string, string | null>): string {
  return Object.entries(values)
    .map(
      ([column, value]) =>
        `${column}=${value === null ? "∅" : JSON.stringify(value)}`,
    )
    .join(", ");
}
