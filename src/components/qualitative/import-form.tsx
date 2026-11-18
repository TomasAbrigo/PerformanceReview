"use client";

import { CardCollection } from "@/components/card-collection";
import { FileUp } from "lucide-react";
import { IconTile } from "@/components/experience";
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
    <section className="admin-surface flex flex-col gap-5">
      <IconTile>
        <FileUp className="size-5" />
      </IconTile>
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
            <CardCollection role="group" aria-label={t("import.unmatched")}>
              {result.unmatched.map((u) => (
                <article key={u.line} className="record-card">
                  <h3 className="text-lg">{u.employee}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t("import.row")}: {u.line}
                  </p>
                  <p className="insight-callout">
                    {t(`import.reasons.${u.reason}`)}
                  </p>
                </article>
              ))}
            </CardCollection>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
