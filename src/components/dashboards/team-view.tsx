import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ManagerTeam } from "@/modules/analytics/dashboards/types";
import { Empty, Meter, pct } from "./parts";

/** A manager's subtree, indented by level, with each member's rating meter. */
export function TeamView({ data }: { data: ManagerTeam }) {
  const t = useTranslations("Dashboards");
  if (!data.members.length) return <Empty />;
  return (
    <table className="text-sm" data-testid="team-table">
      <thead>
        <tr>
          <th className="p-1 text-left">{t("team.member")}</th>
          <th className="p-1 text-left">{t("filters.jobTitle")}</th>
          <th className="p-1 text-left">{t("team.depth")}</th>
          <th className="p-1 text-left">{t("team.rating")}</th>
        </tr>
      </thead>
      <tbody>
        {data.members.map((m) => (
          <tr key={m.personId} className="border-t">
            <td className="p-1" style={{ paddingLeft: `${m.depth * 12}px` }}>
              <Link
                href={`/dashboards/people/${m.personId}`}
                className="underline"
              >
                {m.name}
              </Link>
            </td>
            <td className="p-1">{m.jobTitle ?? t("none")}</td>
            <td className="p-1 tabular-nums">{m.depth}</td>
            <td className="p-1">
              {m.normalized === null ? (
                <span className="text-muted-foreground">
                  {m.participantId ? "—" : t("team.notInCycle")}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Meter
                    width={100}
                    value={m.normalized}
                    label={`${m.name}: ${pct(m.normalized)} %`}
                  />
                  <span className="tabular-nums">{pct(m.normalized)} %</span>
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
