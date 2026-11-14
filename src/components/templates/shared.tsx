"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import type { LocalizedText as Localized } from "@/db/schema/rating-scales";
import type { ActionResult } from "@/lib/action-result";
import type { FieldIssue } from "@/lib/domain-error";

export type { ActionResult, FieldIssue, Localized };

/** Picks the label in the current UI locale. */
export function useLocalized() {
  const locale = useLocale();
  return (text: Localized) => (locale === "en" ? text.en : text.es);
}

/** Translates domain error codes and field issues to UI messages. */
export function useErrorText() {
  const t = useTranslations("Errors");
  return {
    code: (code: string) =>
      t.has(code as "unknown") ? t(code as "unknown") : t("unknown"),
    issue: (issue: FieldIssue) => {
      if (issue.message === "required") {
        if (issue.path.endsWith(".es")) return t("missingEs");
        if (issue.path.endsWith(".en")) return t("missingEn");
        return t("required");
      }
      if (issue.message === "min_options") return t("minOptions");
      if (issue.message === "duplicate_values") return t("duplicateValues");
      if (issue.message === "duplicate_role") return t("duplicateRole");
      return t("invalid");
    },
  };
}

/** Runs a server action, keeping its pending state and error result. */
export function useAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<Extract<
    ActionResult,
    { ok: false }
  > | null>(null);
  function run<T>(
    action: () => Promise<ActionResult<T>>,
    onSuccess?: (result: { ok: true } & T) => void,
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setError(null);
        onSuccess?.(result);
      } else {
        setError(result);
      }
    });
  }
  const issueAt = (path: string) => error?.issues.find((i) => i.path === path);
  return { pending, error, run, issueAt };
}

export function ErrorAlert({
  error,
}: {
  error: Extract<ActionResult, { ok: false }> | null;
}) {
  const text = useErrorText();
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {text.code(error.code)}
    </p>
  );
}

/** A pair of inputs, one per locale, showing which one is missing. */
export function LocalizedInputs({
  id,
  labels,
  value,
  onChange,
  issueAt,
  path,
}: {
  id: string;
  labels: Localized;
  value: Localized;
  onChange: (value: Localized) => void;
  issueAt: (path: string) => FieldIssue | undefined;
  path: string;
}) {
  const text = useErrorText();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(["es", "en"] as const).map((locale) => {
        const issue = issueAt(`${path}.${locale}`);
        const inputId = `${id}-${locale}`;
        return (
          <Field key={locale} data-invalid={issue ? true : undefined}>
            <FieldLabel htmlFor={inputId}>{labels[locale]}</FieldLabel>
            <Input
              id={inputId}
              value={value[locale]}
              aria-invalid={issue ? true : undefined}
              onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
            />
            {issue ? <FieldError>{text.issue(issue)}</FieldError> : null}
          </Field>
        );
      })}
    </div>
  );
}
