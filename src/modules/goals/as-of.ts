import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { rowsOf } from "@/lib/sql";
import { isUuid } from "@/lib/uuid";
import { todayLocal } from "@/modules/org-history/dates";
import { goalAsOf } from "./state";

/**
 * The reference date "Vencido" is measured against for the goals of a cycle
 * (`goalAsOf`: today while its period runs, the end of the period once it is
 * closed), read from the cycle. `null` for a cycle that does not exist (the
 * callers decide what that means: `not_found`, or the live goals' today).
 * Server side only: the rule itself is pure, in `state.ts`.
 */
export async function cycleGoalAsOf(
  db: DbOrTx,
  cycleId: string,
  today: string = todayLocal(),
): Promise<string | null> {
  if (!isUuid(cycleId)) return null;
  const [cycle] = rowsOf<{ status: string; periodEnd: string }>(
    await db.execute(sql`
      select status::text as status, period_end::text as "periodEnd"
      from review_cycle
      where id = ${cycleId}::uuid and deleted_at is null`),
  );
  return cycle ? goalAsOf(cycle, today) : null;
}
