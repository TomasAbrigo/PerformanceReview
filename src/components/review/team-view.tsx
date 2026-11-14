"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import type { RequestStatus } from "@/modules/review-core/request-status";

export type TeamViewRow = {
  cycleId: string;
  cycleName: string;
  participantId: string;
  revieweeName: string;
  selfRequestId: string | null;
  selfStatus: RequestStatus | null;
  managerRequestId: string | null;
  managerStatus: RequestStatus | null;
  sharedAt: Date | null;
};

/** The manager's direct reports with their review statuses (/team). */
export function TeamView({
  rows,
  hasPerson,
  remind,
}: {
  rows: TeamViewRow[];
  hasPerson: boolean;
  remind: (requestId: string) => Promise<ActionResult>;
}) {
  const t = useTranslations("Team");
  const tStatus = useTranslations("Review.status");
  const tErr = useTranslations("Review.errors");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const status = (s: RequestStatus | null) => tStatus(s ?? "none");

  function sendReminder(row: TeamViewRow) {
    if (!row.selfRequestId) return;
    const id = row.selfRequestId;
    startTransition(async () => {
      const result = await remind(id);
      setMessage(
        result.ok
          ? t("reminded", { name: row.revieweeName })
          : tErr.has(result.code as "unknown")
            ? tErr(result.code as "unknown")
            : tErr("unknown"),
      );
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {!hasPerson ? (
        <p className="text-muted-foreground">{t("noPerson")}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table aria-label={t("tableLabel")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("person")}</TableHead>
              <TableHead>{t("cycle")}</TableHead>
              <TableHead>{t("self")}</TableHead>
              <TableHead>{t("manager")}</TableHead>
              <TableHead>{t("shared")}</TableHead>
              <TableHead>{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.cycleId}-${row.participantId}`}>
                <TableCell>{row.revieweeName}</TableCell>
                <TableCell>{row.cycleName}</TableCell>
                <TableCell>{status(row.selfStatus)}</TableCell>
                <TableCell>{status(row.managerStatus)}</TableCell>
                <TableCell>{row.sharedAt ? t("yes") : t("no")}</TableCell>
                <TableCell className="flex flex-wrap gap-2">
                  {row.managerRequestId ? (
                    <Link
                      href={`/cycles/${row.cycleId}/manager/${row.participantId}`}
                      className={buttonVariants({ size: "sm" })}
                    >
                      {t("open")}
                    </Link>
                  ) : null}
                  {row.selfRequestId && row.selfStatus === "draft" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => sendReminder(row)}
                    >
                      {t("remind")}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p role="status" className="text-sm">
        {message}
      </p>
    </div>
  );
}
