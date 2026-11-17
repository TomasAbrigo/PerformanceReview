"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

type Outcome =
  | { ok: true; remapped: number; resolved: number }
  | { ok: false; code: string };

/** Re-applies the Likert equivalences to imported answers (People only). */
export function ReapplyButton({ action }: { action: () => Promise<Outcome> }) {
  const t = useTranslations("DataQuality");
  const te = useTranslations("Errors");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        title={t("reapplyHelp")}
        onClick={() =>
          start(async () => {
            const outcome = await action();
            setMessage(
              outcome.ok
                ? t("reapplyDone", { count: outcome.remapped })
                : te("unknown"),
            );
          })
        }
      >
        {t("reapply")}
      </Button>
      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
