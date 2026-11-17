import { useTranslations } from "next-intl";
import { sentiments } from "@/modules/qualitative-analysis/constants";
import type { QualitativeParams } from "./params";

/** GET form: the filters live in the URL. */
export function QualitativeFilters({
  params,
  cycles,
  departments,
  dimensions,
  themes,
  dimensionLabel,
  showAggregate,
}: {
  params: QualitativeParams;
  cycles: { id: string; name: string }[];
  departments: string[];
  dimensions: string[];
  themes: string[];
  dimensionLabel: Record<string, string>;
  showAggregate: boolean;
}) {
  const t = useTranslations("Qualitative.filters");
  const ts = useTranslations("Qualitative.sentiment");
  const select = (
    name: keyof QualitativeParams,
    label: string,
    values: { value: string; label: string }[],
    any: string = t("any"),
  ) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select
        name={name}
        defaultValue={String(params[name] ?? "")}
        className="rounded-md border px-2 py-1"
      >
        <option value="">{any}</option>
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
      aria-label={t("label")}
      className="flex flex-wrap items-end gap-3"
    >
      {select(
        "cycle",
        t("cycle"),
        cycles.map((c) => ({ value: c.id, label: c.name })),
        t("allCycles"),
      )}
      {select(
        "department",
        t("department"),
        departments.map((d) => ({ value: d, label: d })),
      )}
      {select(
        "dimension",
        t("dimension"),
        dimensions.map((d) => ({ value: d, label: dimensionLabel[d] ?? d })),
      )}
      {select(
        "sentiment",
        t("sentiment"),
        sentiments.map((s) => ({ value: s, label: ts(s) })),
      )}
      {select(
        "theme",
        t("theme"),
        themes.map((th) => ({ value: th, label: th })),
      )}
      {showAggregate ? (
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            name="aggregate"
            value="1"
            defaultChecked={params.aggregate}
          />
          {t("aggregate")}
        </label>
      ) : null}
      <button type="submit" className="rounded-md border px-3 py-1 text-sm">
        {t("apply")}
      </button>
    </form>
  );
}
