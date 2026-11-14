"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useId } from "react";
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
import type { AuditLogItem } from "@/modules/review-core/admin-audit";
import {
  type AdminAction,
  adminActions,
} from "@/modules/review-core/ops-constants";
import { diffSnapshots, formatDiffValue } from "./ops-diff";

/** Before/after of one entry: only the fields that changed. */
function Changes({ entry }: { entry: AuditLogItem }) {
  const t = useTranslations("Ops.audit");
  const changes = diffSnapshots(entry.before, entry.after);
  return (
    <details>
      <summary className="cursor-pointer text-sm underline">
        {t("details")}
      </summary>
      {changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noChanges")}</p>
      ) : (
        <table aria-label={t("changes")} className="mt-2 text-sm">
          <thead>
            <tr>
              <th className="pr-4 text-left">{t("field")}</th>
              <th className="pr-4 text-left">{t("before")}</th>
              <th className="text-left">{t("after")}</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.path}>
                <td className="pr-4 align-top">
                  <code>{c.path}</code>
                </td>
                <td className="pr-4 align-top break-all text-muted-foreground">
                  {formatDiffValue(c.before)}
                </td>
                <td className="align-top break-all">
                  {formatDiffValue(c.after)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

/**
 * The administrative audit log of a cycle (#17): who did what to whom, when
 * and why, with the before/after of every action. The action filter is a
 * plain GET form (`?action=`), read by the page.
 */
export function OpsAuditLog({
  cycleId,
  cycleName,
  entries,
  action,
}: {
  cycleId: string;
  cycleName: string;
  entries: AuditLogItem[];
  action: AdminAction | null;
}) {
  const t = useTranslations("Ops.audit");
  const format = useFormatter();
  const id = useId();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href={`/cycles/${cycleId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          {t("back")}
        </Link>
        <h1 className="text-2xl font-semibold">
          {t("title", { cycle: cycleName })}
        </h1>
      </header>

      <form
        method="get"
        aria-label={t("filterLabel")}
        className="flex flex-wrap items-end gap-3"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-action`} className="text-sm font-medium">
            {t("filter")}
          </label>
          <select
            id={`${id}-action`}
            name="action"
            defaultValue={action ?? ""}
            className="h-9 rounded-md border bg-transparent px-2"
          >
            <option value="">{t("allActions")}</option>
            {adminActions.map((a) => (
              <option key={a} value={a}>
                {t(`actions.${a}`)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          {t("apply")}
        </Button>
      </form>

      {entries.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <Table aria-label={t("tableLabel")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.when")}</TableHead>
              <TableHead>{t("columns.actor")}</TableHead>
              <TableHead>{t("columns.action")}</TableHead>
              <TableHead>{t("columns.target")}</TableHead>
              <TableHead>{t("columns.note")}</TableHead>
              <TableHead>{t("columns.details")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  {format.dateTime(e.createdAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </TableCell>
                <TableCell>{e.actorName ?? t("system")}</TableCell>
                <TableCell>{t(`actions.${e.action}`)}</TableCell>
                <TableCell>
                  {e.targetLabel ??
                    (e.targetType === "cycle" ? t("cycleTarget") : "—")}
                </TableCell>
                <TableCell>{e.note ?? ""}</TableCell>
                <TableCell>
                  <Changes entry={e} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
