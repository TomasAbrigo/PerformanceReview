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
import { Link } from "@/i18n/navigation";
import type { CycleStatus } from "@/modules/review-core/status";
import { CycleStatusBadge } from "./cycle-status-badge";

export type CycleDetailData = {
  id: string;
  name: string;
  status: CycleStatus;
  periodStart: string;
  periodEnd: string;
  snapshotDate: string;
  questionCount: number;
  stats: { active: number; removed: number; withoutManager: number };
  participants: {
    id: string;
    displayName: string;
    snapManagerName: string | null;
    snapDepartment: string | null;
    snapJobTitle: string | null;
    withoutManager: boolean;
    removedAt: Date | null;
  }[];
};

/** A cycle as a read-only container: its period and its participants' snapshot. */
export function CycleDetailView({ cycle }: { cycle: CycleDetailData }) {
  const t = useTranslations("Cycles");
  const td = useTranslations("Cycles.detail");

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
    </div>
  );
}
