"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";

export type { ActionResult };

/** Translates a domain error code to a UI message. */
function useErrorText() {
  const t = useTranslations("Errors");
  return {
    code: (code: string) =>
      t.has(code as "unknown") ? t(code as "unknown") : t("unknown"),
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
