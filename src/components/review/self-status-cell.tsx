"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RequestStatus } from "@/modules/review-core/request-status";

export type SelfReviewColumn = {
  byParticipant: Record<string, { requestId: string; status: RequestStatus }>;
  canUnlock: boolean;
  unlock: (requestId: string, note: string | null) => Promise<ActionResult>;
};

/** Self review status of a participant, with HR's audited unlock. */
export function SelfStatusCell({
  request,
  canUnlock,
  unlock,
}: {
  request: { requestId: string; status: RequestStatus } | undefined;
  canUnlock: boolean;
  unlock: SelfReviewColumn["unlock"];
}) {
  const t = useTranslations("Review");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!request) return <span>{t("status.none")}</span>;

  function confirm() {
    startTransition(async () => {
      const result = await unlock(request!.requestId, note || null);
      if (result.ok) setOpen(false);
      else setError(t("errors.unknown"));
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <Badge
          variant={request.status === "submitted" ? "default" : "secondary"}
        >
          {t(`status.${request.status}`)}
        </Badge>
        {canUnlock && request.status === "submitted" && !open ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {t("unlock")}
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={id} className="sr-only">
            {t("unlockNote")}
          </label>
          <Input
            id={id}
            className="h-8 w-48"
            placeholder={t("unlockNote")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button size="sm" onClick={confirm} disabled={pending}>
            {t("unlockConfirm")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {t("cancel")}
          </Button>
        </div>
      ) : null}
      {error ? (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
