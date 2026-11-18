"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ImportOutcome } from "./actions-types";

/** Upload a labels CSV (HR); shows the rows that did not match. */
export function ImportLabelsForm({
  importLabels,
}: {
  importLabels: (form: FormData) => Promise<ImportOutcome>;
}) {
  const t = useTranslations("Qualitative");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ImportOutcome | null>(null);
  return (
    <section className="flex flex-col gap-2">
      <h2>{t("import.title")}</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          start(async () => setResult(await importLabels(form)));
        }}
      >
        <label className="control-label">
          {t("import.file")}
          <input type="file" name="file" accept=".csv,text/csv" required />
        </label>
        <Button type="submit" variant="outline" disabled={pending}>
          {t("import.button")}
        </Button>
      </form>
      {result && !result.ok ? (
        <p role="alert" className="text-sm">
          {t(`errors.${result.code}` as "errors.unknown")}
        </p>
      ) : null}
      {result?.ok ? (
        <div role="status" className="flex flex-col gap-1 text-sm">
          <p>
            {t("import.done", {
              total: result.total,
              matched: result.matched,
              unmatched: result.unmatched.length,
            })}
          </p>
          {result.unmatched.length > 0 ? (
            <table aria-label={t("import.unmatched")}>
              <thead>
                <tr className="text-left">
                  <th className="pr-4">{t("import.row")}</th>
                  <th className="pr-4">{t("import.employee")}</th>
                  <th className="pr-4">{t("import.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {result.unmatched.map((u) => (
                  <tr key={u.line}>
                    <td className="pr-4 tabular-nums">{u.line}</td>
                    <td className="pr-4">{u.employee}</td>
                    <td className="pr-4">{t(`import.reasons.${u.reason}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
