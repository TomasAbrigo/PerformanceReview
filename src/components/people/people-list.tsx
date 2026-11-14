import { useTranslations } from "next-intl";
import { ExportCsvLink } from "@/components/data-quality/export-csv-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import type { PersonListItem } from "@/modules/people/queries";
import { StatusBadge } from "./status-badge";

export function PeopleList({
  people,
  query,
}: {
  people: PersonListItem[];
  query: string;
}) {
  const t = useTranslations("People");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <ExportCsvLink file="people" params={{ q: query }} />
      </div>
      <form role="search" method="get" className="flex max-w-md gap-2">
        <Input
          type="search"
          name="q"
          defaultValue={query}
          aria-label={t("searchLabel")}
          placeholder={t("searchPlaceholder")}
        />
        <Button type="submit">{t("search")}</Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {t("total", { count: people.length })}
      </p>
      {people.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.email")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link href={`/people/${p.id}`} className="hover:underline">
                    {p.displayName}
                  </Link>
                </TableCell>
                <TableCell>{p.workEmail ?? "—"}</TableCell>
                <TableCell>
                  <StatusBadge status={p.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
