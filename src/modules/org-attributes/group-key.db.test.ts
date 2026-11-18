import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { appSetting } from "@/db/schema";
import { getSettings } from "@/modules/settings";
import { GROUP_KEY_SECRET, groupKeyer, keyerFor } from "./group-key";

beforeEach(async () => {
  await db.delete(appSetting).where(eq(appSetting.key, GROUP_KEY_SECRET));
});
afterAll(async () => {
  await db.delete(appSetting).where(eq(appSetting.key, GROUP_KEY_SECRET));
  await closeDb();
});

describe("groupKeyer", () => {
  it("generates a random secret once and keeps it: the same name has the same key every time", async () => {
    const first = await groupKeyer(db);
    const again = await groupKeyer(db);

    expect(first("Marta Quiroga")).toBe(again("Marta Quiroga"));
    expect(first("Marta Quiroga")).not.toBe(first("Nora Salas"));
    const rows = await db
      .select()
      .from(appSetting)
      .where(eq(appSetting.key, GROUP_KEY_SECRET));
    expect(rows).toHaveLength(1);
    expect(String(rows[0].value)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is a keyed hash: another install (another secret) gives other keys, and no key carries the name", async () => {
    const key = (await groupKeyer(db))("Marta Quiroga");
    // A key anyone can compute from the name alone would be a lookup table.
    const guesses = [
      keyerFor("")("Marta Quiroga"),
      keyerFor("secret")("Marta Quiroga"),
      keyerFor("0".repeat(64))("Marta Quiroga"),
    ];

    expect(guesses).not.toContain(key);
    expect(key).toMatch(/^g[0-9a-f]{16}$/);
    expect(key.toLowerCase()).not.toContain("marta");
    expect(keyerFor("a")("Marta")).not.toBe(keyerFor("b")("Marta"));
  });

  it("survives a person-less reset: the secret is not a setting the screens list", async () => {
    await groupKeyer(db);

    const settings = await getSettings(db);

    expect(Object.keys(settings)).not.toContain(GROUP_KEY_SECRET);
    expect(JSON.stringify(settings)).not.toMatch(/[0-9a-f]{64}/);
  });

  it("never reaches the client: no component imports it and the shared module has no hash", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? files(full) : [full];
      });
    for (const file of files("src/components").filter((f) =>
      /\.(ts|tsx)$/.test(f),
    )) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/group-key/);
    }
    const shared = readFileSync("src/modules/org-attributes/kinds.ts", "utf8");
    expect(shared).not.toMatch(/createHmac|node:crypto|charCodeAt/);
  });
});
