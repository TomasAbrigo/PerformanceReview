import { useTranslations } from "next-intl";
import type { IngestCounts } from "@/db/schema/ingest";

/** The parts of the rows read, in the order a run settles them. */
const PARTS = [
  ["inserted", "bg-status-done"],
  ["updated", "bg-brand-500"],
  ["unchanged", "bg-brand-200"],
  ["ignored", "bg-muted-foreground/30"],
  ["rejected", "bg-status-pending"],
] as const;

/**
 * What became of the rows a run read, as one stacked bar (inserted, updated,
 * unchanged, ignored, rejected) with a legend of the parts that are there.
 * The rejected part links to `rejectsHref` (the reject log) when given.
 */
export function RunOutcome({
  counts,
  rejectsHref,
  compact = false,
}: {
  counts: Partial<IngestCounts>;
  rejectsHref?: string;
  compact?: boolean;
}) {
  const t = useTranslations("Imports.runs");
  const read = counts.read ?? 0;
  const parts = PARTS.map(([key, color]) => ({
    key,
    color,
    n: counts[key] ?? 0,
  })).filter((p) => p.n > 0);
  const label = t("outcome.label", {
    read,
    parts: parts.map((p) => `${t(`columns.${p.key}`)} ${p.n}`).join(", "),
  });
  if (read === 0) {
    return (
      <p className="text-xs text-muted-foreground">{t("outcome.nothing")}</p>
    );
  }
  const total = Math.max(
    read,
    parts.reduce((s, p) => s + p.n, 0),
  );
  return (
    <div className="flex flex-col gap-2" data-testid="run-outcome">
      <div
        role="img"
        aria-label={label}
        title={label}
        className={`flex w-full overflow-hidden rounded-full bg-brand-fog ${compact ? "h-2" : "h-3.5"}`}
      >
        {parts.map((p) => (
          <span
            key={p.key}
            className={p.color}
            style={{ width: `${(p.n / total) * 100}%` }}
          />
        ))}
      </div>
      {compact ? null : (
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          {parts.map((p) => (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              <span
                className={`size-2.5 rounded-full ${p.color}`}
                aria-hidden="true"
              />
              {p.key === "rejected" && rejectsHref ? (
                <a href={rejectsHref} className="text-foreground underline">
                  {t(`columns.${p.key}`)}
                </a>
              ) : (
                t(`columns.${p.key}`)
              )}
              <span className="text-foreground tabular-nums">
                {p.n} ({Math.round((p.n / total) * 100)} %)
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
