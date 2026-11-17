import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { goalCtes, reachOf, requireCycle } from "./scope";
import type { GoalInsightsFilterOptions, Hierarchy } from "./types";

/**
 * Values for the filter selects: the areas (and managers) of the participants
 * the actor reads. Direction gets the areas only: it never sees a person.
 */
export async function goalInsightsFilterOptions(
  db: DbOrTx,
  actor: ActorContext,
  input: { cycleId: string; hierarchy?: Hierarchy },
): Promise<GoalInsightsFilterOptions> {
  const reach = await reachOf(db, actor);
  await requireCycle(db, input.cycleId);
  const rows = await db.execute<{
    department: string | null;
    manager_id: string | null;
    manager_name: string | null;
  }>(sql`
    with ${goalCtes(reach, { cycleId: input.cycleId, hierarchy: input.hierarchy ?? "asOf" })}
    select distinct department, manager_id, manager_name from base`);
  const departments = [
    ...new Set(rows.flatMap((r) => (r.department ? [r.department] : []))),
  ].sort((a, b) => a.localeCompare(b, "es"));
  const managers = new Map<string, string>();
  if (reach.kind !== "aggregatesOnly") {
    for (const r of rows) {
      if (r.manager_id && r.manager_name) {
        managers.set(r.manager_id, r.manager_name);
      }
    }
  }
  return {
    departments,
    managers: [...managers]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
  };
}
