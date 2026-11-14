import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import type { HistoryImportResult } from "@/modules/import-history/results";

/**
 * What a historical import (a Bamboo performance or feedback report) did,
 * per detected cycle: participants, requests and answers created or left
 * unchanged, rows sent to the identity queue and reviewer mismatches.
 */
export function HistoryResult({ result }: { result: HistoryImportResult }) {
  const t = useTranslations("ImportHistory");
  const both = (created: number, unchanged: number) =>
    t("createdUnchanged", { created, unchanged });

  return (
    <div className="flex flex-col gap-6">
      <Link href="/imports/runs" className="text-sm hover:underline">
        {t("back")}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("summary", { count: result.cycles.length })}
        </p>
      </div>

      <Table aria-label={t("cycles")}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.cycle")}</TableHead>
            <TableHead>{t("columns.period")}</TableHead>
            <TableHead className="text-right">{t("columns.rows")}</TableHead>
            <TableHead className="text-right">
              {t("columns.participants")}
            </TableHead>
            <TableHead>{t("columns.requests")}</TableHead>
            <TableHead>{t("columns.answers")}</TableHead>
            <TableHead className="text-right">{t("columns.issues")}</TableHead>
            <TableHead className="text-right">
              {t("columns.mismatches")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.cycles.map((c) => (
            <TableRow key={c.cycleId}>
              <TableCell>
                <Link href={`/cycles/${c.cycleId}`} className="hover:underline">
                  {c.name}
                </Link>
              </TableCell>
              <TableCell className="tabular-nums">
                {t("period", { start: c.periodStart, end: c.periodEnd })}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {c.rows}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {c.participantsCreated}
              </TableCell>
              <TableCell>
                {both(c.requestsCreated, c.requestsUnchanged)}
              </TableCell>
              <TableCell>
                {both(c.answersCreated, c.answersUnchanged)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {c.issues > 0 ? (
                  <Link
                    href="/imports/identity"
                    className="font-medium text-destructive hover:underline"
                  >
                    {c.issues}
                  </Link>
                ) : (
                  0
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {c.mismatches}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-sm text-muted-foreground">{t("mismatchHint")}</p>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/imports/runs/${result.runId}`}
          className={buttonVariants({ variant: "outline" })}
        >
          {t("viewRun")}
        </Link>
        <Link
          href="/imports/identity"
          className={buttonVariants({ variant: "outline" })}
        >
          {t("viewQueue")}
        </Link>
      </div>
    </div>
  );
}
