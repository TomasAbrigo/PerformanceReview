import { useTranslations } from "next-intl";
import {
  isMissing,
  type MissingPerson,
  type SideStatus,
} from "@/modules/analytics/completion/types";

const GLYPH: Record<SideStatus, string> = {
  submitted: "✓",
  in_progress: "◐",
  not_started: "○",
  not_applicable: "–",
};

/** A status as a chip: a glyph and the word, never color alone. */
export function StatusChip({ status }: { status: SideStatus }) {
  const t = useTranslations("Completion.missing.statuses");
  const missing = isMissing(status);
  return (
    <span
      data-status={status}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap ${
        missing ? "border-foreground font-medium" : "text-muted-foreground"
      }`}
    >
      <span aria-hidden="true">{GLYPH[status]}</span>
      {t(status)}
    </span>
  );
}

/**
 * "Quién falta": one row per person with a side of their assessment still to
 * be submitted, with the area and manager of the chosen hierarchy. The
 * follow-up notes of the report are not shown, only that there are some.
 */
export function MissingTable({ rows }: { rows: MissingPerson[] }) {
  const t = useTranslations("Completion.missing");
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm" role="status">
        {t("count", { n: rows.length })}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label={t("title")} className="w-full text-sm">
            <thead>
              <tr>
                {(
                  [
                    "person",
                    "department",
                    "manager",
                    "self",
                    "managerReview",
                    "notes",
                  ] as const
                ).map((c) => (
                  <th key={c} className="p-1 text-left font-medium">
                    {t(`columns.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.participantId} className="border-t">
                  <th scope="row" className="p-1 text-left font-medium">
                    {r.name}
                  </th>
                  <td className="p-1">{r.department ?? t("none")}</td>
                  <td className="p-1">{r.managerName ?? t("none")}</td>
                  <td className="p-1">
                    <StatusChip status={r.selfStatus} />
                  </td>
                  <td className="p-1">
                    <StatusChip status={r.managerStatus} />
                  </td>
                  <td className="p-1">
                    {r.hasFollowUpNotes ? t("notes") : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
