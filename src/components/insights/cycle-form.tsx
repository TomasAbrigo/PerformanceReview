import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * GET form with the cycle select (and an optional group-by select); the
 * other params ride along hidden. Plain HTML: the state lives in the URL.
 */
export function CycleForm({
  cycles,
  cycleId,
  hidden = {},
  groupBy,
  children,
}: {
  cycles: { id: string; name: string }[];
  cycleId: string;
  hidden?: Record<string, string>;
  groupBy?: "department" | "manager";
  /** More fields of the form (the org selects), before the button. */
  children?: React.ReactNode;
}) {
  const t = useTranslations("Insights");
  return (
    <form aria-label={t("filters")} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        {t("cycle")}
        <select
          name="cycle"
          defaultValue={cycleId}
          className="rounded-md border px-2 py-1"
        >
          {cycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {groupBy ? (
        <label className="flex flex-col gap-1 text-sm">
          {t("groupBy.label")}
          <select
            name="groupBy"
            defaultValue={groupBy}
            className="rounded-md border px-2 py-1"
          >
            <option value="department">{t("groupBy.department")}</option>
            <option value="manager">{t("groupBy.manager")}</option>
          </select>
        </label>
      ) : null}
      {children}
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" variant="outline">
        {t("apply")}
      </Button>
    </form>
  );
}
