"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Button } from "@/components/ui/button";

/** HR: shares every submitted manager review of a cycle at once. */
export function ManagerShareAll({
  cycleId,
  shareAll,
}: {
  cycleId: string;
  shareAll: (cycleId: string) => Promise<ActionResult<{ count: number }>>;
}) {
  const t = useTranslations("ManagerReview");
  const tErr = useTranslations("Review.errors");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await shareAll(cycleId);
            setMessage(
              result.ok
                ? t("sharedCount", { count: result.count })
                : tErr("unknown"),
            );
          })
        }
      >
        {t("shareAll")}
      </Button>
      <p role="status" className="text-sm">
        {message}
      </p>
    </div>
  );
}
