import { useTranslations } from "next-intl";
import type { IndicatorSubjects } from "@/modules/analytics/indicators/queries";
import type { TrendParams } from "./url-state";

/** Who to draw: a person, a team (manager) or an area; a GET form. */
export function TrendPicker({
  params,
  subjects,
}: {
  params: TrendParams;
  subjects: IndicatorSubjects;
}) {
  const t = useTranslations("Indicators");
  const select = (
    name: keyof TrendParams,
    label: string,
    values: { value: string; label: string }[],
  ) =>
    values.length === 0 ? null : (
      <label className="flex flex-col gap-1 text-sm">
        {label}
        <select
          name={name}
          defaultValue={params[name] ?? ""}
          className="rounded-md border bg-background px-2 py-1"
        >
          <option value="">{t("trend.pick.any")}</option>
          {values.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <form
      method="get"
      aria-label={t("trend.pick.label")}
      className="flex flex-wrap items-end gap-3"
    >
      {select(
        "person",
        t("trend.pick.person"),
        subjects.people.map((p) => ({ value: p.id, label: p.name })),
      )}
      {select(
        "manager",
        t("trend.pick.manager"),
        subjects.managers.map((m) => ({ value: m.id, label: m.name })),
      )}
      {select(
        "department",
        t("trend.pick.department"),
        subjects.departments.map((d) => ({ value: d, label: d })),
      )}
      <button type="submit" className="rounded-md border px-3 py-1 text-sm">
        {t("trend.pick.apply")}
      </button>
    </form>
  );
}
