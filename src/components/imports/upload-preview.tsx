"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProfileIssue, SourceProfile } from "@/modules/lake/profiles";
import type { LakeColumn, LakeRow } from "@/modules/lake/types";

/** Issues of a file against a profile, as user-facing sentences. */
export function useIssueText() {
  const t = useTranslations("Upload.issues");
  const role = (issue: Extract<ProfileIssue, { kind: "missing_column" }>) => {
    switch (issue.role) {
      case "key":
        return t("roles.key");
      case "watermark":
        return t("roles.watermark");
      case "soft_delete":
        return t("roles.soft_delete");
      case "mapped":
        return t("roles.mapped");
    }
  };
  return (issue: ProfileIssue) =>
    issue.kind === "missing_column"
      ? [
          t("missing_column", { column: issue.column, role: role(issue) }),
          issue.suggestion
            ? t("suggestion", { suggestion: issue.suggestion })
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      : t("type_mismatch", {
          column: issue.column,
          actual: issue.actual,
          expected: issue.expected.join(" / "),
        });
}

/** What the profile does with each column of the file, for the columns table. */
function usesOf(profile: SourceProfile | null, column: string) {
  if (!profile) return [];
  const uses: {
    kind: "key" | "watermark" | "soft_delete" | "mapped";
    field?: string;
  }[] = [];
  if (profile.keyColumns.includes(column)) uses.push({ kind: "key" });
  if (profile.watermarkColumn === column) uses.push({ kind: "watermark" });
  if (profile.softDeleteColumn === column) uses.push({ kind: "soft_delete" });
  const field = profile.columnMap[column];
  if (field) uses.push({ kind: "mapped", field });
  return uses;
}

const FLAGGED = "bg-destructive/10 text-destructive";

/**
 * Detected columns with their type and what the chosen profile does with
 * them. A column with the wrong type and a column the profile needs but the
 * file lacks are flagged (`data-issue`).
 */
export function ColumnsTable({
  columns,
  profile,
  issues,
}: {
  columns: LakeColumn[];
  profile: SourceProfile | null;
  issues: ProfileIssue[];
}) {
  const t = useTranslations("Upload");
  const typeIssues = new Set(
    issues.filter((i) => i.kind === "type_mismatch").map((i) => i.column),
  );
  const missing = issues.filter((i) => i.kind === "missing_column");

  return (
    <Table aria-label={t("preview.columns")}>
      <TableHeader>
        <TableRow>
          <TableHead>{t("preview.columnName")}</TableHead>
          <TableHead>{t("preview.columnType")}</TableHead>
          <TableHead>{t("preview.columnUse")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {columns.map((column) => {
          const uses = usesOf(profile, column.name);
          const flagged = typeIssues.has(column.name);
          return (
            <TableRow
              key={column.name}
              data-issue={flagged ? "type_mismatch" : undefined}
              className={flagged ? FLAGGED : undefined}
            >
              <TableCell className="font-medium">{column.name}</TableCell>
              <TableCell className="font-mono text-xs">{column.type}</TableCell>
              <TableCell>
                <span className="flex flex-wrap gap-1">
                  {uses.length === 0 ? (
                    <span className="text-muted-foreground">
                      {t("preview.unused")}
                    </span>
                  ) : (
                    uses.map((use) => (
                      <Badge
                        key={`${use.kind}-${use.field ?? ""}`}
                        variant={use.kind === "key" ? "default" : "secondary"}
                      >
                        {use.kind === "mapped"
                          ? t("roles.mapped", { field: use.field ?? "" })
                          : use.kind === "key"
                            ? t("roles.key")
                            : use.kind === "watermark"
                              ? t("roles.watermark")
                              : t("roles.soft_delete")}
                      </Badge>
                    ))
                  )}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
        {missing.map((issue) => (
          <TableRow
            key={`missing-${issue.column}`}
            data-issue="missing_column"
            className={FLAGGED}
          >
            <TableCell className="font-medium">{issue.column}</TableCell>
            <TableCell>—</TableCell>
            <TableCell>{t("preview.missingInFile")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The first rows of the file; headers of mismatched columns are flagged. */
export function RowsTable({
  columns,
  rows,
  issues,
}: {
  columns: LakeColumn[];
  rows: LakeRow[];
  issues: ProfileIssue[];
}) {
  const t = useTranslations("Upload");
  const typeIssues = new Set(
    issues.filter((i) => i.kind === "type_mismatch").map((i) => i.column),
  );

  return (
    <div className="flex flex-col gap-2">
      <Table aria-label={t("preview.rows")}>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.name}
                data-issue={
                  typeIssues.has(column.name) ? "type_mismatch" : undefined
                }
                className={typeIssues.has(column.name) ? FLAGGED : undefined}
              >
                {column.name}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              {columns.map((column) => (
                <TableCell
                  key={column.name}
                  className="max-w-64 truncate"
                  title={cellText(row[column.name])}
                >
                  {cellText(row[column.name]) || (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("preview.noRows")}</p>
      ) : null}
    </div>
  );
}

function cellText(value: LakeRow[string] | undefined): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** The problems of a file with a profile, in one alert. */
export function IssueList({ issues }: { issues: ProfileIssue[] }) {
  const t = useTranslations("Upload");
  const text = useIssueText();
  if (issues.length === 0) return null;
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <p className="font-medium">{t("issues.title")}</p>
      <ul className="list-disc pl-5">
        {issues.map((issue) => (
          <li key={`${issue.kind}-${issue.column}`}>{text(issue)}</li>
        ))}
      </ul>
    </div>
  );
}
