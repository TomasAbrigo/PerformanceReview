import type { DbOrTx } from "@/db/client";
import { likertMapping } from "@/db/schema";
import {
  defaultLikertMappings,
  type LikertOverrides,
  likertRoles,
} from "./index";

/**
 * Inserts the default equivalences that are missing (server start). Rows that
 * exist, default or custom, are left alone: an edit by People always wins.
 */
export async function seedLikertMappings(db: DbOrTx): Promise<void> {
  const rows = likertRoles.flatMap((role) =>
    Object.entries(defaultLikertMappings[role]).flatMap(([count, letters]) =>
      Object.entries(letters).map(([sourceOption, value]) => ({
        role,
        sourceOption,
        optionCount: Number(count),
        value,
        source: "default" as const,
      })),
    ),
  );
  await db.insert(likertMapping).values(rows).onConflictDoNothing();
}

/** The table as overrides for mapLikert: role -> "<count>:<option>" -> value. */
export async function loadLikertOverrides(
  db: DbOrTx,
): Promise<LikertOverrides> {
  const rows = await db.select().from(likertMapping);
  const overrides: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    (overrides[row.role] ??= {})[`${row.optionCount}:${row.sourceOption}`] =
      row.value;
  }
  return overrides;
}
