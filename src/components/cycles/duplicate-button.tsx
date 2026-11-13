"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { useCycleError } from "./errors";

export type DuplicateAction = (
  cycleId: string,
  /** Word in the UI language that goes between parentheses after the name. */
  suffix: string,
) => Promise<ActionResult<{ id: string }>>;

/** Copies the cycle as a new draft and opens it. Available in any status. */
export function DuplicateButton({
  cycleId,
  duplicate,
}: {
  cycleId: string;
  duplicate: DuplicateAction;
}) {
  const t = useTranslations("Cycles.extras.duplicate");
  const router = useRouter();
  const errorText = useCycleError();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await duplicate(cycleId, t("suffix"));
      if (result.ok) {
        setError(null);
        router.push(`/cycles/${result.id}`);
      } else {
        setError(errorText(result.code));
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={run} disabled={pending}>
        {pending ? t("pending") : t("button")}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
