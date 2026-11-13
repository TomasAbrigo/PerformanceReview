import { useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import type { JobHistoryItem } from "@/modules/org-history/queries";

export function JobHistoryTable({ rows }: { rows: JobHistoryItem[] }) {
  const t = useTranslations("Org.history");
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">{t("title")}</h2>
      {rows.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <Table aria-label={t("title")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("validFrom")}</TableHead>
              <TableHead>{t("validTo")}</TableHead>
              <TableHead>{t("jobTitle")}</TableHead>
              <TableHead>{t("area")}</TableHead>
              <TableHead>{t("manager")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.validFrom}</TableCell>
                <TableCell>{r.validTo ?? t("current")}</TableCell>
                <TableCell>{r.jobTitle ?? "—"}</TableCell>
                <TableCell>
                  {[r.department, r.division].filter(Boolean).join(" / ") ||
                    "—"}
                </TableCell>
                <TableCell>
                  {r.managerPersonId && r.managerName ? (
                    <Link
                      href={`/people/${r.managerPersonId}`}
                      className="hover:underline"
                    >
                      {r.managerName}
                    </Link>
                  ) : r.managerRaw ? (
                    t("unresolved", { name: r.managerRaw })
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
