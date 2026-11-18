// Server only (node:crypto, the database): nothing under src/components may
// import it, and the client bundle must never carry the secret.
import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { appSetting } from "@/db/schema";
import type { GroupKeyer } from "./kinds";

/** `app_setting` row holding the secret (not a setting of the settings screen: it is never listed or edited). */
export const GROUP_KEY_SECRET = "org.groupKeySecret";

/** The keyer of a secret: `g` + 16 hex of HMAC-SHA256(secret, value). */
export const keyerFor =
  (secret: string): GroupKeyer =>
  (value) =>
    `g${createHmac("sha256", secret).update(value).digest("hex").slice(0, 16)}`;

/**
 * The keyer direction's views use for the groups that name a person (DMs,
 * Santex Leads): the same value gets the same key in every cycle and view (so
 * teams can be told apart and followed), and nobody without the secret of this
 * install can turn a key back into a name, even with a list of names to try.
 * The secret is random, generated the first time it is needed and kept in
 * `app_setting` (the seed leaves it alone, so keys survive a reset).
 */
export async function groupKeyer(db: DbOrTx): Promise<GroupKeyer> {
  const read = async () => {
    const [row] = await db
      .select({ value: appSetting.value })
      .from(appSetting)
      .where(eq(appSetting.key, GROUP_KEY_SECRET));
    return typeof row?.value === "string" ? row.value : null;
  };
  let secret = await read();
  if (!secret) {
    await db
      .insert(appSetting)
      .values({
        key: GROUP_KEY_SECRET,
        value: randomBytes(32).toString("hex"),
      })
      .onConflictDoNothing();
    secret = await read();
  }
  if (!secret) throw new Error("Could not read or create the group key secret");
  return keyerFor(secret);
}
