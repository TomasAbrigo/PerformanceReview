"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Button } from "@/components/ui/button";

/** HR publishes the calibration of a cycle, after a confirmation. */
export function PublishCalibration({
  cycleId,
  publishedAt,
  publish,
}: {
  cycleId: string;
  publishedAt: Date | null;
  publish: (cycleId: string) => Promise<ActionResult<{ count: number }>>;
}) {
  const t = useTranslations("Calibration");
  const format = useFormatter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (publishedAt) {
    return (
      <p role="status">
        {t("publishedAt", { date: format.dateTime(new Date(publishedAt)) })}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Button className="self-start" onClick={() => setConfirming(true)}>
        {t("publish")}
      </Button>
      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="publish-title"
          className="flex flex-col gap-2 rounded-md border p-4"
        >
          <p id="publish-title" className="font-medium">
            {t("publishConfirmTitle")}
          </p>
          <p>{t("publishConfirmBody")}</p>
          <div className="flex gap-2">
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await publish(cycleId);
                  setConfirming(false);
                  setMessage(
                    result.ok
                      ? t("publishedCount", { count: result.count })
                      : t("errors.unknown"),
                  );
                })
              }
            >
              {t("publishConfirm")}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
