import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { adminAuditLog, appSetting } from "@/db/schema";
import { DomainError, type FieldIssue } from "@/lib/domain-error";
import { requireHr } from "@/modules/actor/access";
import type { ActorContext } from "@/modules/actor/types";
import {
  checkSettings,
  DEFAULT_SETTINGS,
  isSettingKey,
  parseSettingValue,
  type SettingKey,
  type SettingValue,
  type Settings,
  settingKeys,
} from "./definitions";

export class SettingsError extends DomainError<"validation"> {}

/** The effective settings out of the stored rows: an override, else the default. */
function effective(rows: Map<string, unknown>): Settings {
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of settingKeys) {
    if (!rows.has(key)) continue;
    // A value that no longer validates (edited by hand) never breaks a page.
    const parsed = parseSettingValue(key, rows.get(key));
    if (parsed.success) Object.assign(settings, { [key]: parsed.data });
  }
  return settings;
}

const storedRows = async (db: DbOrTx) =>
  new Map((await db.select().from(appSetting)).map((r) => [r.key, r.value]));

/** The effective settings: the stored override of each key, else its default. */
export async function getSettings(db: DbOrTx): Promise<Settings> {
  return effective(await storedRows(db));
}

export async function getSetting<K extends SettingKey>(
  db: DbOrTx,
  key: K,
): Promise<SettingValue<K>> {
  return (await getSettings(db))[key];
}

/**
 * Changes several settings at once (People only): all or nothing, validated
 * per key and across keys on the final state, and every value that actually
 * changes is written to `admin_audit_log` (before and after). Returns the keys
 * that changed (a value equal to the current one is not a change).
 */
export async function updateSettings(
  db: DbOrTx,
  actor: ActorContext,
  patch: Partial<Record<SettingKey, unknown>>,
): Promise<SettingKey[]> {
  requireHr(actor);
  const issues: FieldIssue[] = [];
  const parsed: Partial<Settings> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!isSettingKey(key)) {
      issues.push({ path: key, message: "unknown_key" });
      continue;
    }
    const result = parseSettingValue(key, value);
    if (result.success) Object.assign(parsed, { [key]: result.data });
    else issues.push(...result.issues.map((i) => ({ path: key, ...i })));
  }
  if (issues.length) throw new SettingsError("validation", issues);

  return db.transaction(async (tx) => {
    // One writer at a time: the read below and the writes must not interleave
    // with another save (no lost update, no change audited twice).
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('app_setting', 0))`,
    );
    const rows = await storedRows(tx);
    const current = effective(rows);
    // A change is a difference with what is *stored* (or the default when
    // there is no row): saving the default over an invalid row repairs it.
    const before = (key: SettingKey): unknown =>
      rows.has(key) ? rows.get(key) : DEFAULT_SETTINGS[key];
    const changed = (Object.keys(parsed) as SettingKey[]).filter(
      (key) => parsed[key] !== before(key),
    );
    if (changed.some((key) => key.startsWith("semester."))) {
      const crossed = checkSettings({ ...current, ...parsed });
      if (crossed.length) throw new SettingsError("validation", crossed);
    }
    for (const key of changed) {
      await tx
        .insert(appSetting)
        .values({ key, value: parsed[key], updatedBy: actor.personId })
        .onConflictDoUpdate({
          target: appSetting.key,
          set: {
            value: parsed[key],
            updatedBy: actor.personId,
            updatedAt: sql`now()`,
          },
        });
      await tx.insert(adminAuditLog).values({
        actorPersonId: actor.personId,
        action: "setting.update",
        targetType: "app_setting",
        targetKey: key,
        before: { value: before(key) },
        after: { value: parsed[key] },
      });
    }
    return changed;
  });
}

/** Changes one setting (People only); see `updateSettings`. */
export async function setSetting<K extends SettingKey>(
  db: DbOrTx,
  actor: ActorContext,
  key: K,
  value: SettingValue<K>,
): Promise<void> {
  await updateSettings(db, actor, { [key]: value });
}
