import type { DbOrTx } from "@/db/client";
import { person, type IdentityCandidate } from "@/db/schema";
import { normalizeName } from "@/modules/identity/normalize";

/** Normalized display name -> the people who carry it. */
export type NameIndex = Map<string, string[]>;

export async function loadNameIndex(db: DbOrTx): Promise<NameIndex> {
  const rows = await db
    .select({ id: person.id, name: person.displayName })
    .from(person);
  const index: NameIndex = new Map();
  for (const row of rows) {
    const key = normalizeName(row.name);
    index.set(key, [...(index.get(key) ?? []), row.id]);
  }
  return index;
}

export type NameMatch =
  | { personId: string }
  | {
      reason: "no_match" | "ambiguous";
      candidates: IdentityCandidate[];
    };

/**
 * Report rows identify people by name only: a unique normalized match is
 * conclusive; several people with that name, or nobody, need a human.
 */
export function matchName(index: NameIndex, name: string): NameMatch {
  const ids = index.get(normalizeName(name)) ?? [];
  if (ids.length === 1) return { personId: ids[0] };
  return {
    reason: ids.length ? "ambiguous" : "no_match",
    candidates: ids.map((personId) => ({
      personId,
      score: 0.3,
      matchedOn: ["name"],
    })),
  };
}
