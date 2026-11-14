"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type {
  NominationStatus,
  PeerApproval,
} from "@/modules/review-core/peer-settings";

export type NominationRow = {
  id: string;
  nomineePersonId: string;
  nomineeName: string;
  status: NominationStatus;
  openRequests: number;
  overloaded: boolean;
};

export type NominationsPickerData = {
  participantId: string;
  cycleName: string;
  canEdit: boolean;
  max: number;
  /** 'none': nominations need no approval. */
  approval?: PeerApproval;
  nominations: NominationRow[];
  candidates: {
    personId: string;
    displayName: string;
    openRequests: number;
    overloaded: boolean;
  }[];
};

export type NominationsActions = {
  nominate: (participantId: string, personId: string) => Promise<ActionResult>;
  remove: (nominationId: string) => Promise<ActionResult>;
};

/** Load counter of a person, with a warning badge over the threshold. */
export function LoadBadge({
  openRequests,
  overloaded,
}: {
  openRequests: number;
  overloaded: boolean;
}) {
  const t = useTranslations("Peers");
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      {t("load", { count: openRequests })}
      {overloaded ? (
        <Badge variant="destructive">{t("overloaded")}</Badge>
      ) : null}
    </span>
  );
}

export function usePeerError() {
  const t = useTranslations("Peers.errors");
  return (code: string) =>
    t.has(code as "unknown") ? t(code as "unknown") : t("unknown");
}

/** The employee picks peers to give them feedback, up to the cycle's max. */
export function NominationsPicker({
  data,
  actions,
}: {
  data: NominationsPickerData;
  actions: NominationsActions;
}) {
  const t = useTranslations("Peers");
  const errorText = usePeerError();
  const id = useId();
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const live = data.nominations.filter(
    (n) => n.status === "pending" || n.status === "approved",
  );
  const full = live.length >= data.max;
  const shown = data.nominations.filter((n) => n.status !== "removed");
  const chosen = data.candidates.find((c) => c.personId === choice);

  function run(fn: () => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await fn();
      setError(result.ok ? null : errorText(result.code));
      if (result.ok) setChoice("");
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">
        {t("nominationsTitle", { cycle: data.cycleName })}
      </h1>
      <p className="text-muted-foreground">
        {t(
          data.approval === "none"
            ? "nominationsIntroNone"
            : "nominationsIntro",
        )}
      </p>
      <p className="font-medium">
        {t("count", { count: live.length, max: data.max })}
      </p>
      {shown.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((n) => (
            <li
              key={n.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
            >
              <div className="flex flex-col">
                <span className="font-medium">{n.nomineeName}</span>
                <LoadBadge
                  openRequests={n.openRequests}
                  overloaded={n.overloaded}
                />
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{t(`status.${n.status}`)}</Badge>
                {data.canEdit && n.status === "pending" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run(() => actions.remove(n.id))}
                  >
                    {t("remove")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!data.canEdit ? (
        <p className="text-muted-foreground">{t("closed")}</p>
      ) : full ? (
        <p className="text-muted-foreground">{t("capReached")}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-candidate`}>{t("candidate")}</Label>
            <select
              id={`${id}-candidate`}
              className="h-9 rounded-md border bg-transparent px-2"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
            >
              <option value="">{t("choose")}</option>
              {data.candidates.map((c) => (
                <option key={c.personId} value={c.personId}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </div>
          <Button
            disabled={!choice || pending}
            onClick={() =>
              run(() => actions.nominate(data.participantId, choice))
            }
          >
            {t("nominate")}
          </Button>
          {chosen ? (
            <LoadBadge
              openRequests={chosen.openRequests}
              overloaded={chosen.overloaded}
            />
          ) : null}
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
