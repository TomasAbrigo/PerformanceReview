import { asc, inArray, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { adminAuditLog, appSetting, person } from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import {
  DEFAULT_SETTINGS,
  getSetting,
  getSettings,
  setSetting,
  updateSettings,
} from ".";

const hr: ActorContext = { personId: null, role: "hr" };

const created: string[] = [];

async function newPerson(displayName: string): Promise<string> {
  const [{ id }] = await db
    .insert(person)
    .values({ displayName })
    .returning({ id: person.id });
  created.push(id);
  return id;
}

async function reset() {
  await db.execute(sql`TRUNCATE app_setting, admin_audit_log`);
  if (created.length) {
    await db.delete(person).where(inArray(person.id, created.splice(0)));
  }
}

const audit = () =>
  db.select().from(adminAuditLog).orderBy(asc(adminAuditLog.createdAt));
const stored = () => db.select().from(appSetting);

beforeEach(reset);
afterAll(async () => {
  await reset();
  await closeDb();
});

describe("getSettings / getSetting", () => {
  it("returns the defaults of the code when nothing was changed", async () => {
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
    expect(await getSetting(db, "aggregation.minGroupSize")).toBe(5);
    expect(await getSetting(db, "semester.h1Start")).toBe("01-01");
    expect(await getSetting(db, "analysis.provider")).toBe("mock");
    expect(await stored()).toEqual([]);
  });

  it("falls back to the default for a stored value that no longer validates", async () => {
    await db
      .insert(appSetting)
      .values({ key: "aggregation.minGroupSize", value: "muchos" });
    expect(await getSetting(db, "aggregation.minGroupSize")).toBe(5);
    expect((await getSettings(db))["aggregation.minGroupSize"]).toBe(5);
  });

  it("ignores stored keys the code does not know", async () => {
    await db.insert(appSetting).values({ key: "old.thing", value: 1 });
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("setSetting", () => {
  it("stores the value, who changed it and when", async () => {
    const anaId = await newPerson("Ana García");
    const actor: ActorContext = { personId: anaId, role: "hr" };
    await setSetting(db, actor, "aggregation.minGroupSize", 8);
    expect(await getSetting(db, "aggregation.minGroupSize")).toBe(8);
    const [row] = await stored();
    expect(row).toMatchObject({
      key: "aggregation.minGroupSize",
      value: 8,
      updatedBy: anaId,
    });
    expect(row.updatedAt).toBeInstanceOf(Date);
    // The rest keeps its defaults.
    expect(await getSettings(db)).toEqual({
      ...DEFAULT_SETTINGS,
      "aggregation.minGroupSize": 8,
    });
  });

  it("writes one audit row per change with before and after", async () => {
    await setSetting(db, hr, "alerts.dropThreshold", 3);
    await setSetting(db, hr, "alerts.dropThreshold", 1);
    const rows = await audit();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      actorPersonId: null,
      action: "setting.update",
      targetType: "app_setting",
      targetKey: "alerts.dropThreshold",
      targetId: null,
      cycleId: null,
      before: { value: 2 },
      after: { value: 3 },
    });
    expect(rows[1]).toMatchObject({
      before: { value: 3 },
      after: { value: 1 },
    });
  });

  it("records the acting person in the audit row", async () => {
    const id = await newPerson("Dora Díaz");
    await setSetting(
      db,
      { personId: id, role: "hr" },
      "analysis.provider",
      "anthropic",
    );
    const [row] = await audit();
    expect(row.actorPersonId).toBe(id);
  });

  it("is a no-op, with no audit, when the value does not change", async () => {
    await setSetting(db, hr, "aggregation.minGroupSize", 5);
    expect(await audit()).toEqual([]);
    expect(await stored()).toEqual([]);
    await setSetting(db, hr, "aggregation.minGroupSize", 6);
    await setSetting(db, hr, "aggregation.minGroupSize", 6);
    expect(await audit()).toHaveLength(1);
  });

  it("saving the default repairs a stored value that no longer validates", async () => {
    await db
      .insert(appSetting)
      .values({ key: "aggregation.minGroupSize", value: "muchos" });
    // The effective value is already the default, but the row is garbage:
    // saving the default is a change and writes it over.
    await setSetting(db, hr, "aggregation.minGroupSize", 5);
    expect(await stored()).toMatchObject([
      { key: "aggregation.minGroupSize", value: 5 },
    ]);
    expect(await audit()).toMatchObject([
      {
        targetKey: "aggregation.minGroupSize",
        before: { value: "muchos" },
        after: { value: 5 },
      },
    ]);
  });

  it("can go back to the default value, keeping the audit trail", async () => {
    await setSetting(db, hr, "semester.ambiguityDays", 30);
    await setSetting(db, hr, "semester.ambiguityDays", 15);
    expect(await getSetting(db, "semester.ambiguityDays")).toBe(15);
    expect(await audit()).toHaveLength(2);
  });

  it.each([
    ["aggregation.minGroupSize", 1, "out_of_range"],
    ["aggregation.minGroupSize", "5", "invalid_number"],
    ["alerts.dropThreshold", 9, "out_of_range"],
    ["alerts.riskThreshold", 0, "out_of_range"],
    ["semester.h1Start", "02-30", "invalid_day"],
    ["semester.ambiguityDays", -1, "out_of_range"],
    ["analysis.provider", "gpt", "invalid_choice"],
  ] as const)(
    "rejects %s = %j (%s) and changes nothing",
    async (key, value, message) => {
      await expect(
        setSetting(db, hr, key, value as never),
      ).rejects.toMatchObject({
        code: "validation",
        issues: [{ path: key, message }],
      });
      expect(await stored()).toEqual([]);
      expect(await audit()).toEqual([]);
    },
  );

  it("rejects a setting the code does not define", async () => {
    await expect(
      setSetting(db, hr, "nope" as never, 1 as never),
    ).rejects.toMatchObject({
      code: "validation",
      issues: [{ path: "nope", message: "unknown_key" }],
    });
  });

  it("rejects an H1 start that is not before the H2 start", async () => {
    await expect(
      setSetting(db, hr, "semester.h1Start", "07-01"),
    ).rejects.toMatchObject({
      code: "validation",
      issues: [{ path: "semester.h2Start", message: "semester_order" }],
    });
    await setSetting(db, hr, "semester.h2Start", "09-01");
    await setSetting(db, hr, "semester.h1Start", "08-01");
    expect(await getSetting(db, "semester.h1Start")).toBe("08-01");
  });
});

describe("only People change settings", () => {
  const others: [string, ActorContext][] = [
    [
      "a manager",
      { personId: "00000000-0000-4000-8000-000000000001", role: "manager" },
    ],
    [
      "an employee",
      { personId: "00000000-0000-4000-8000-000000000001", role: "employee" },
    ],
    ["direction", { personId: null, role: "direction" }],
  ];
  it.each(others)(
    "%s is forbidden and nothing is written",
    async (_name, actor) => {
      await expect(
        setSetting(db, actor, "aggregation.minGroupSize", 2),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        updateSettings(db, actor, { "alerts.dropThreshold": 3 }),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(await stored()).toEqual([]);
      expect(await audit()).toEqual([]);
    },
  );
});

describe("concurrent saves", () => {
  it("do not lose updates or audit the same change twice", async () => {
    await Promise.all([
      setSetting(db, hr, "aggregation.minGroupSize", 8),
      setSetting(db, hr, "aggregation.minGroupSize", 8),
      setSetting(db, hr, "aggregation.minGroupSize", 8),
    ]);
    expect(await getSetting(db, "aggregation.minGroupSize")).toBe(8);
    expect(await audit()).toMatchObject([
      { before: { value: 5 }, after: { value: 8 } },
    ]);
  });

  it("keep every key that different saves changed", async () => {
    await Promise.all([
      setSetting(db, hr, "alerts.dropThreshold", 3),
      setSetting(db, hr, "alerts.riskThreshold", 1),
      setSetting(db, hr, "semester.ambiguityDays", 30),
    ]);
    expect(await getSettings(db)).toEqual({
      ...DEFAULT_SETTINGS,
      "alerts.dropThreshold": 3,
      "alerts.riskThreshold": 1,
      "semester.ambiguityDays": 30,
    });
    expect(await audit()).toHaveLength(3);
  });

  it("a chain of saves of one key audits each step from the previous value", async () => {
    await Promise.all([
      setSetting(db, hr, "aggregation.minGroupSize", 6),
      setSetting(db, hr, "aggregation.minGroupSize", 7),
    ]);
    const rows = await audit();
    expect(rows).toHaveLength(2);
    const steps = rows.map((r) => [
      (r.before as { value: number }).value,
      (r.after as { value: number }).value,
    ]);
    // Whichever went first, the second starts where the first ended.
    const [first] = steps.filter(([before]) => before === 5);
    const [second] = steps.filter(([before]) => before !== 5);
    expect(first).toBeDefined();
    expect(second[0]).toBe(first[1]);
    expect(await getSetting(db, "aggregation.minGroupSize")).toBe(second[1]);
  });
});

describe("updateSettings", () => {
  it("applies several changes together, validating the final state", async () => {
    // H1 to August and H2 to September: valid together even though the first
    // alone would not be (H1 after the default H2).
    const changed = await updateSettings(db, hr, {
      "semester.h1Start": "08-01",
      "semester.h2Start": "09-01",
      "alerts.dropThreshold": 2,
    });
    expect(changed).toEqual(["semester.h1Start", "semester.h2Start"]);
    expect(await getSettings(db)).toEqual({
      ...DEFAULT_SETTINGS,
      "semester.h1Start": "08-01",
      "semester.h2Start": "09-01",
    });
    expect((await audit()).map((r) => r.targetKey).sort()).toEqual([
      "semester.h1Start",
      "semester.h2Start",
    ]);
  });

  it("is all or nothing: one invalid value rolls everything back", async () => {
    await expect(
      updateSettings(db, hr, {
        "alerts.dropThreshold": 3,
        "aggregation.minGroupSize": 1,
      }),
    ).rejects.toMatchObject({
      code: "validation",
      issues: [{ path: "aggregation.minGroupSize", message: "out_of_range" }],
    });
    expect(await stored()).toEqual([]);
    expect(await audit()).toEqual([]);
  });

  it("reports every invalid value at once", async () => {
    await expect(
      updateSettings(db, hr, {
        "alerts.dropThreshold": 9,
        "semester.h1Start": "13-01",
      }),
    ).rejects.toMatchObject({
      issues: [
        { path: "alerts.dropThreshold", message: "out_of_range" },
        { path: "semester.h1Start", message: "invalid_day" },
      ],
    });
  });
});
