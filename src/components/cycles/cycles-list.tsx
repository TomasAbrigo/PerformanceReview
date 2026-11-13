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
import type { CycleStatus } from "@/modules/review-core/status";
import { CycleStatusBadge } from "./cycle-status-badge";

export type CycleRow = {
  id: string;
  name: string;
  status: CycleStatus;
  periodStart: string;
  periodEnd: string;
  participantCount: number;
};

export function CyclesList({ cycles }: { cycles: CycleRow[] }) {
  const t = useTranslations("Cycles");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Link href="/cycles/new" className={buttonVariants()}>
          {t("new")}
        </Link>
      </div>
      {cycles.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead>{t("columns.period")}</TableHead>
              <TableHead className="text-right">
                {t("columns.participants")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cycles.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link href={`/cycles/${c.id}`} className="hover:underline">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <CycleStatusBadge status={c.status} />
                </TableCell>
                <TableCell>
                  {t("period", { start: c.periodStart, end: c.periodEnd })}
                </TableCell>
                <TableCell className="text-right">
                  {c.participantCount}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
