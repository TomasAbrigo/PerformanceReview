"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import type { CycleStatus } from "@/modules/review-core/status";
import { CycleStatusBadge } from "./cycle-status-badge";
import { useCycleError } from "./errors";

export type CycleDetailData = {
  id: string;
  name: string;
  status: CycleStatus;
  periodStart: string;
  periodEnd: string;
  snapshotDate: string;
  questionCount: number;
  stats: { active: number; removed: number; withoutManager: number };
  allowedTransitions: CycleStatus[];
  participants: {
    id: string;
    displayName: string;
    snapManagerName: string | null;
    snapDepartment: string | null;
    snapJobTitle: string | null;
    withoutManager: boolean;
    removedAt: Date | null;
  }[];
  transitions: {
    id: string;
    fromStatus: CycleStatus;
    toStatus: CycleStatus;
    actorName: string | null;
    note: string | null;
    createdAt: Date;
  }[];
};

export type CycleDetailActions = {
  transition: (id: string, to: CycleStatus) => Promise<ActionResult>;
  launch: (id: string) => Promise<ActionResult>;
};

export function CycleDetailView({
  cycle,
  actions,
}: {
  cycle: CycleDetailData;
  actions: CycleDetailActions;
}) {
  const t = useTranslations("Cycles");
  const td = useTranslations("Cycles.detail");
  const format = useFormatter();
  const errorText = useCycleError();
  const [confirming, setConfirming] = useState<CycleStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const targets: CycleStatus[] =
    cycle.status === "draft" ? [] : cycle.allowedTransitions;

  function confirm() {
    const to = confirming;
    if (!to) return;
    startTransition(async () => {
      const result =
        cycle.status === "draft"
          ? await actions.launch(cycle.id)
          : await actions.transition(cycle.id, to);
      if (result.ok) {
        setError(null);
        setConfirming(null);
      } else {
        setError(errorText(result.code));
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href="/cycles"
          className="text-sm text-muted-foreground hover:underline"
        >
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{cycle.name}</h1>
          <CycleStatusBadge status={cycle.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("period", { start: cycle.periodStart, end: cycle.periodEnd })} ·{" "}
          {td("snapshotDate", { date: cycle.snapshotDate })} ·{" "}
          {td("questions", { count: cycle.questionCount })}
        </p>
      </header>

      <section aria-labelledby="cycle-actions" className="flex flex-col gap-2">
        <h2 id="cycle-actions" className="text-lg font-medium">
          {td("actions")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {cycle.status === "draft" ? (
            <Button onClick={() => setConfirming("nominations")}>
              {td("launch")}
            </Button>
          ) : null}
          {targets.map((to) => (
            <Button
              key={to}
              variant="outline"
              onClick={() => setConfirming(to)}
            >
              {td("moveTo", { status: t(`status.${to}`) })}
            </Button>
          ))}
          {cycle.status !== "draft" && targets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{td("noActions")}</p>
          ) : null}
        </div>
        {confirming ? (
          <div
            role="alertdialog"
            aria-labelledby="confirm-title"
            className="flex flex-col gap-2 rounded-md border p-4"
          >
            <p id="confirm-title" className="font-medium">
              {td("confirmTitle")}
            </p>
            {cycle.status !== "draft" ? (
              <p>
                {td("confirmBody", {
                  from: t(`status.${cycle.status}`),
                  to: t(`status.${confirming}`),
                })}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button onClick={confirm} disabled={pending}>
                {td("confirm")}
              </Button>
              <Button
                variant="outline"
                onClick={() => setConfirming(null)}
                disabled={pending}
              >
                {td("cancel")}
              </Button>
            </div>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="cycle-participants"
        className="flex flex-col gap-2"
      >
        <h2 id="cycle-participants" className="text-lg font-medium">
          {td("participants")}
        </h2>
        {cycle.participants.length === 0 ? (
          <p>{td("noParticipants")}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {td("stats", cycle.stats)}
            </p>
            <Table aria-label={td("participants")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{td("columns.name")}</TableHead>
                  <TableHead>{td("columns.manager")}</TableHead>
                  <TableHead>{td("columns.department")}</TableHead>
                  <TableHead>{td("columns.jobTitle")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cycle.participants.map((p) => (
                  <TableRow
                    key={p.id}
                    className={p.removedAt ? "opacity-60" : undefined}
                  >
                    <TableCell>
                      {p.displayName}{" "}
                      {p.removedAt ? (
                        <Badge variant="secondary">{td("removed")}</Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {p.withoutManager ? (
                        <Badge variant="destructive">{td("noManager")}</Badge>
                      ) : (
                        p.snapManagerName
                      )}
                    </TableCell>
                    <TableCell>{p.snapDepartment ?? "—"}</TableCell>
                    <TableCell>{p.snapJobTitle ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </section>

      <section
        aria-labelledby="cycle-transitions"
        className="flex flex-col gap-2"
      >
        <h2 id="cycle-transitions" className="text-lg font-medium">
          {td("transitions")}
        </h2>
        {cycle.transitions.length === 0 ? (
          <p>{td("noTransitions")}</p>
        ) : (
          <Table aria-label={td("transitions")}>
            <TableHeader>
              <TableRow>
                <TableHead>{td("columns.from")}</TableHead>
                <TableHead>{td("columns.to")}</TableHead>
                <TableHead>{td("columns.actor")}</TableHead>
                <TableHead>{td("columns.when")}</TableHead>
                <TableHead>{td("columns.note")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cycle.transitions.map((tr) => (
                <TableRow key={tr.id}>
                  <TableCell>{t(`status.${tr.fromStatus}`)}</TableCell>
                  <TableCell>{t(`status.${tr.toStatus}`)}</TableCell>
                  <TableCell>{tr.actorName ?? td("system")}</TableCell>
                  <TableCell>
                    {format.dateTime(tr.createdAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </TableCell>
                  <TableCell>{tr.note ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
