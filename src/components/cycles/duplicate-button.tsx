"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import type { DuplicateWarning } from "@/modules/review-core/status";
import { useCycleError } from "./errors";

export type DuplicateAction = (
  cycleId: string,
  /** Word in the UI language that goes between parentheses after the name. */
  suffix: string,
) => Promise<ActionResult<{ id: string; warnings: DuplicateWarning[] }>>;

/**
 * Copies the cycle as a new draft and opens it. Available in any status. If
 * something could not be copied (a template that is gone), it says so before
 * the user lands on the draft.
 */
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
  const [copy, setCopy] = useState<{
    id: string;
    warnings: DuplicateWarning[];
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await duplicate(cycleId, t("suffix"));
      if (!result.ok) {
        setError(errorText(result.code));
        return;
      }
      setError(null);
      if (result.warnings.length === 0) {
        router.push(`/cycles/${result.id}`);
      } else {
        setCopy({ id: result.id, warnings: result.warnings });
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
      {copy ? (
        <div role="status" className="flex flex-col gap-1 text-sm">
          <ul className="list-disc pl-5">
            {copy.warnings.map((w) => (
              <li key={w.kind === "group" ? `group-${w.name}` : w.kind}>
                {w.kind === "template"
                  ? t("warnTemplate")
                  : t("warnGroup", { name: w.name })}
              </li>
            ))}
          </ul>
          <Link href={`/cycles/${copy.id}`} className="underline">
            {t("openCopy")}
          </Link>
        </div>
      ) : null}
    </>
  );
}
