import { useFormatter, useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import type { PersonDetailData } from "@/modules/people/queries";
import { StatusBadge } from "./status-badge";

export function PersonDetail({ person }: { person: PersonDetailData }) {
  const t = useTranslations("People");
  const format = useFormatter();
  const fmt = (d: Date | null) =>
    d ? format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" }) : "—";

  return (
    <div className="flex flex-col gap-6">
      <Link href="/people" className="text-sm hover:underline">
        {t("back")}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{person.displayName}</h1>
        <p className="text-muted-foreground">{person.workEmail ?? "—"}</p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">{t("identities.title")}</h2>
        <Table aria-label={t("identities.title")}>
          <TableCaption className="sr-only">
            {t("identities.title")}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t("identities.kind")}</TableHead>
              <TableHead>{t("identities.value")}</TableHead>
              <TableHead>{t("identities.validFrom")}</TableHead>
              <TableHead>{t("identities.validTo")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {person.identities.map((i) => (
              <TableRow key={`${i.kind}:${i.value}`}>
                <TableCell>{t(`identities.kinds.${i.kind}`)}</TableCell>
                <TableCell className="font-mono">{i.value}</TableCell>
                <TableCell>{fmt(i.validFrom)}</TableCell>
                <TableCell>
                  {i.validTo ? fmt(i.validTo) : t("identities.current")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">{t("employments.title")}</h2>
        {person.employments.length === 0 ? (
          <p>{t("employments.empty")}</p>
        ) : (
          <Table aria-label={t("employments.title")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("employments.hireDate")}</TableHead>
                <TableHead>{t("employments.terminationDate")}</TableHead>
                <TableHead>{t("employments.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {person.employments.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.hireDate ?? "—"}</TableCell>
                  <TableCell>{e.terminationDate ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={e.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
