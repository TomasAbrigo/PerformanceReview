"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Button } from "@/components/ui/button";
import type { PendingApproval } from "@/modules/review-core/peers";
import { LoadBadge, usePeerError } from "./nominations-picker";

export type DecideAction = (
  ids: string[],
  decision: "approved" | "declined",
) => Promise<ActionResult>;

/** Pending nominations the manager (or HR) approves or declines. */
export function NominationsApprovals({
  items,
  decide,
}: {
  items: PendingApproval[];
  decide: DecideAction;
}) {
  const t = useTranslations("Peers");
  const errorText = usePeerError();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(ids: string[], decision: "approved" | "declined") {
    startTransition(async () => {
      const result = await decide(ids, decision);
      setError(result.ok ? null : errorText(result.code));
      if (result.ok) setSelected(new Set());
    });
  }

  return (
    <section aria-labelledby="peer-approvals" className="flex flex-col gap-2">
      <h2 id="peer-approvals" className="text-lg font-medium">
        {t("approvalsTitle")}
      </h2>
      {items.length === 0 ? (
        <p className="text-muted-foreground">{t("approvalsEmpty")}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={t("select", {
                      name: n.nomineeName,
                      reviewee: n.revieweeName,
                    })}
                    checked={selected.has(n.id)}
                    onChange={() => {
                      const next = new Set(selected);
                      if (next.has(n.id)) next.delete(n.id);
                      else next.add(n.id);
                      setSelected(next);
                    }}
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{n.nomineeName}</span>
                    <span className="text-sm text-muted-foreground">
                      {t("reviewee")}: {n.revieweeName} · {n.cycleName}
                    </span>
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <LoadBadge
                    openRequests={n.openRequests}
                    overloaded={n.overloaded}
                  />
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => run([n.id], "approved")}
                  >
                    {t("approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run([n.id], "declined")}
                  >
                    {t("decline")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div>
            <Button
              disabled={selected.size === 0 || pending}
              onClick={() =>
                run(
                  items.filter((n) => selected.has(n.id)).map((n) => n.id),
                  "approved",
                )
              }
            >
              {t("approveSelected")}
            </Button>
          </div>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
