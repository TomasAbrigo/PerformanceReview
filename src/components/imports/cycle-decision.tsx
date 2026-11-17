"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { HistoryImportResult } from "@/modules/import-history/results";

type Decision = NonNullable<HistoryImportResult["decision"]>;

export type ResumeOutcome = { ok: true } | { ok: false; code: string };

const ERRORS = [
  "not_waiting",
  "not_found",
  "unknown_cycle",
  "unknown_proposal",
] as const;

/**
 * A run stopped in `needs_decision`: some report rows could not be placed in
 * a cycle (a date near a semester cutoff, a cycle name that matches none).
 * People pick an existing cycle or create the proposed one; the run then
 * imports those rows and finishes (`resume`, a server action).
 */
export function CycleDecisionForm({
  runId,
  decision,
  resume,
}: {
  runId: string;
  decision: Decision;
  /** `choice`: `cycle:<id>` or `create:<proposal name>`. */
  resume: (runId: string, choice: string) => Promise<ResumeOutcome>;
}) {
  const t = useTranslations("ImportHistory.decision");
  const id = useId();
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const option = (value: string, label: string) => (
    <label key={value} className="flex items-center gap-2 text-sm">
      <input
        type="radio"
        name={`${id}-cycle`}
        value={value}
        checked={choice === value}
        onChange={() => setChoice(value)}
      />
      {label}
    </label>
  );

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 rounded-lg border border-amber-500/50 p-4"
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm">{t("rows", { count: decision.rows })}</p>
      {decision.reasons.map((reason) => (
        <p key={reason} className="text-sm text-muted-foreground">
          {t(`reasons.${reason}`)}
        </p>
      ))}
      {decision.names.length > 0 ? (
        <p className="text-sm">
          {t("names", { names: decision.names.join(", ") })}
        </p>
      ) : null}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!choice) return;
          setError(null);
          startTransition(async () => {
            const outcome = await resume(runId, choice);
            if (!outcome.ok) {
              setError(
                (ERRORS as readonly string[]).includes(outcome.code)
                  ? outcome.code
                  : "unknown",
              );
            }
          });
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("choose")}</legend>
          {decision.proposals.map((p) =>
            option(
              `create:${p.name}`,
              t("create", {
                name: p.name,
                start: p.periodStart,
                end: p.periodEnd,
              }),
            ),
          )}
          {decision.options.map((c) =>
            option(
              `cycle:${c.id}`,
              t("existing", {
                name: c.name,
                start: c.periodStart,
                end: c.periodEnd,
              }),
            ),
          )}
        </fieldset>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${error as (typeof ERRORS)[number] | "unknown"}`)}
          </p>
        ) : null}
        <div>
          <Button type="submit" disabled={!choice || pending}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </div>
      </form>
    </section>
  );
}
