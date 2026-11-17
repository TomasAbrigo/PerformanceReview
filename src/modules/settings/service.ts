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

/** The effective settings: the stored override of each key, else its default. */
export async function getSettings(db: DbOrTx): Promise<Settings> {
  const rows = await db.select().from(appSetting);
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of settingKeys) {
    if (!stored.has(key)) continue;
    // A value that no longer validates (edited by hand) never breaks a page.
    const parsed = parseSettingValue(key, stored.get(key));
    if (parsed.success) Object.assign(settings, { [key]: parsed.data });
  }
  return settings;
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
    const current = await getSettings(tx);
    const changed = (Object.keys(parsed) as SettingKey[]).filter(
      (key) => parsed[key] !== current[key],
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
        before: { value: current[key] },
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
