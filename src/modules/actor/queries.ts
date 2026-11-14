import { asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { person } from "@/db/schema";
import { isUuid } from "@/lib/uuid";

export type ActorOption = { id: string; displayName: string };

/** Lightweight list for the "act as" selector (id + name only). */
export function listActorOptions(db: DbOrTx): Promise<ActorOption[]> {
  return db
    .select({ id: person.id, displayName: person.displayName })
    .from(person)
    .orderBy(asc(person.displayName));
}

export async function personExists(
  db: DbOrTx,
  personId: string,
): Promise<boolean> {
  if (!isUuid(personId)) return false;
  const [row] = await db
    .select({ id: person.id })
    .from(person)
    .where(eq(person.id, personId));
  return !!row;
}
