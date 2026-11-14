"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { type Localized, useLocalized } from "@/components/templates/shared";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  CompareRow,
  CompareSide,
  Comparison,
} from "@/modules/review-core/compare";

const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "-" : "");

/** The text of one side of a row (option label, choice label or text). */
function useSideText() {
  const localized = useLocalized();
  return (row: CompareRow, side: CompareSide) => {
    const value = side.value;
    if (value === null || value === "") return null;
    const { question } = row;
    const options =
      question.kind === "rating"
        ? (question.scale?.options ?? [])
        : question.kind === "single_choice"
          ? (question.choices ?? [])
          : [];
    const option = options.find((o) => String(o.value) === String(value));
    return option ? localized(option.label as Localized) : String(value);
  };
}

/**
 * Self assessment and manager review side by side, per question, with the
 * difference highlighted on ratings. The manager can flip "Employee view" to
 * hide what the employee will not see (for screen sharing); for the employee
 * the comparison already comes limited and there is no toggle.
 */
export function CompareView({
  comparison,
  children,
}: {
  comparison: Comparison;
  /** Rendered under the table (follow-up notes, acknowledgement). */
  children?: ReactNode;
}) {
  const t = useTranslations("Compare");
  const format = useFormatter();
  const localized = useLocalized();
  const sideText = useSideText();
  const [employeeView, setEmployeeView] = useState(false);
  const locked = comparison.employeeView;
  const limited = locked || employeeView;
  const rows = limited
    ? comparison.rows.filter((r) => r.question.visibleToReviewee)
    : comparison.rows;

  const sections: { title: Localized; rows: CompareRow[] }[] = [];
  for (const row of rows) {
    const last = sections.at(-1);
    if (
      last &&
      localized(last.title) === localized(row.question.sectionTitle)
    ) {
      last.rows.push(row);
    } else {
      sections.push({ title: row.question.sectionTitle, rows: [row] });
    }
  }

  const number = (n: number) =>
    `${sign(n)}${format.number(Math.abs(n), { maximumFractionDigits: 2 })}`;
  const percent = (n: number) => `${sign(n)}${Math.abs(Math.round(n * 100))}%`;

  function cell(row: CompareRow, side: CompareSide | null) {
    if (!side) {
      return <span className="text-muted-foreground">{t("notAsked")}</span>;
    }
    const text = sideText(row, side);
    return text === null ? (
      <span className="text-muted-foreground">{t("noAnswer")}</span>
    ) : (
      <span className="whitespace-pre-wrap">{text}</span>
    );
  }

  function deltaCell(row: CompareRow) {
    const delta = row.delta;
    if (!delta)
      return <span className="text-muted-foreground">{t("noDelta")}</span>;
    const values = {
      numeric: number(delta.numeric),
      percent: percent(delta.normalized),
    };
    if (delta.numeric === 0) {
      return <span className="text-muted-foreground">{t("deltaSame")}</span>;
    }
    return (
      <Badge variant={delta.numeric > 0 ? "secondary" : "outline"}>
        {delta.numeric > 0 ? t("deltaHigher", values) : t("deltaLower", values)}
      </Badge>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">
          {t("title", { name: comparison.revieweeName })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("cycle", { cycle: comparison.cycleName })}
        </p>
        {locked ? (
          <p className="text-sm">{t("employeeViewAlways")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={employeeView}
                onChange={(e) => setEmployeeView(e.target.checked)}
              />
              {t("employeeView")}
            </label>
            <p className="text-sm text-muted-foreground">
              {t("employeeViewHint")}
            </p>
            {employeeView ? (
              <p role="status" className="text-sm font-medium">
                {t("employeeViewOn")}
              </p>
            ) : null}
          </div>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t("noRows")}</p>
      ) : (
        sections.map((section, i) => (
          <section key={i} className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">{localized(section.title)}</h2>
            <Table
              aria-label={t("tableLabel", {
                section: localized(section.title),
              })}
            >
              <TableHeader>
                <TableRow>
                  <TableHead>{t("question")}</TableHead>
                  <TableHead>{t("self")}</TableHead>
                  <TableHead>{t("manager")}</TableHead>
                  <TableHead>{t("delta")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {section.rows.map((row) => (
                  <TableRow
                    key={row.question.id}
                    className={row.delta?.numeric ? "bg-muted/50" : undefined}
                  >
                    <TableCell className="align-top whitespace-normal">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">
                          {localized(row.question.prompt)}
                        </span>
                        {!row.question.visibleToReviewee ? (
                          <Badge variant="outline" className="self-start">
                            {t("hiddenFromEmployee")}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      {cell(row, row.self)}
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      {cell(row, row.manager)}
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      {deltaCell(row)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ))
      )}
      {children}
    </div>
  );
}
