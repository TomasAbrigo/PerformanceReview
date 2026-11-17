"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { RunOutcome } from "./actions-types";

/** "Correr análisis" (HR): runs the configured provider over the cycle shown. */
export function RunButton({
  cycleId,
  run,
}: {
  cycleId: string | undefined;
  run: (cycleId: string | undefined) => Promise<RunOutcome>;
}) {
  const t = useTranslations("Qualitative");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RunOutcome | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button
        disabled={pending}
        onClick={() => start(async () => setResult(await run(cycleId)))}
      >
        {pending ? t("run.running") : t("run.button")}
      </Button>
      {result ? (
        <p role="status" className="text-sm">
          {result.ok
            ? `${t("run.provider", { name: result.provider })} · ${t(
                "run.done",
                {
                  total: result.total,
                  analyzed: result.analyzed,
                  cached: result.cached,
                  corrected: result.corrected,
                },
              )}`
            : t(`errors.${result.code}` as "errors.unknown")}
        </p>
      ) : null}
    </div>
  );
}
