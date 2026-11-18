import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { ALL_PEOPLE, scopedCtes } from "@/modules/analytics/dashboards/scope";
import type { Hierarchy } from "@/modules/analytics/dashboards/types";
import { insightsScope } from "@/modules/insights/authz";
import { ReviewError } from "@/modules/review-core/review-errors";
import { type OrgOptions, orgOptionsOf } from "./kinds";

/**
 * The values of the org selects for what `actor` reads: those of the
 * participants in their scope (everybody for People, their direct reports for
 * a manager), of one cycle or of all. Direction reads aggregates: accounts and
 * projects, never the DMs or Santex Leads (they are people). Employees are
 * forbidden.
 */
export async function orgFilterOptions(
  db: DbOrTx,
  actor: ActorContext,
  f: { cycleId?: string; hierarchy?: Hierarchy } = {},
): Promise<OrgOptions> {
  const scope = insightsScope(actor);
  if (scope.kind === "none") throw new ReviewError("forbidden");
  const masked = scope.kind === "aggregatesOnly";
  const rows = await db.execute<{
    account: string | null;
    project: string | null;
    dm: string | null;
    santex_lead: string | null;
  }>(sql`
    with recursive ${scopedCtes(masked ? ALL_PEOPLE : actor, {
      cycleId: f.cycleId,
      hierarchy: f.hierarchy ?? "asOf",
    })}
    select distinct account, project, dm, santex_lead from scoped`);
  return orgOptionsOf(
    rows.map((r) => ({
      account: r.account,
      project: r.project,
      dm: r.dm,
      santexLead: r.santex_lead,
    })),
    !masked,
  );
}
