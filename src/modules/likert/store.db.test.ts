import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { likertMapping } from "@/db/schema";
import { mapLikert } from "./index";
import { loadLikertOverrides, seedLikertMappings } from "./store";

beforeEach(async () => {
  await db.delete(likertMapping);
});
afterAll(async () => {
  await db.delete(likertMapping);
  await seedLikertMappings(db);
  await closeDb();
});

describe("likert_mapping", () => {
  it("seeds the defaults once (18 rows), idempotently", async () => {
    await seedLikertMappings(db);
    await seedLikertMappings(db);
    const rows = await db.select().from(likertMapping);
    expect(rows).toHaveLength(18);
    expect(rows.every((r) => r.source === "default")).toBe(true);
    expect(
      rows.find(
        (r) =>
          r.role === "retention" &&
          r.optionCount === 4 &&
          r.sourceOption === "C",
      )?.value,
    ).toBe(2);
  });

  it("never overwrites a custom row", async () => {
    await seedLikertMappings(db);
    await db
      .update(likertMapping)
      .set({ value: 3, source: "custom", updatedBy: "people" })
      .where(
        and(
          eq(likertMapping.role, "engagement"),
          eq(likertMapping.optionCount, 4),
          eq(likertMapping.sourceOption, "C"),
        ),
      );
    await seedLikertMappings(db);
    const overrides = await loadLikertOverrides(db);
    expect(overrides.engagement?.["4:C"]).toBe(3);
    expect(
      mapLikert({ role: "engagement", optionCount: 4, raw: "C" }, overrides),
    ).toEqual({ value: 3, normalized: 0.5 });
    expect(
      mapLikert({ role: "retention", optionCount: 4, raw: "C" }, overrides),
    ).toEqual({ value: 2, normalized: 0.25 });
  });
});
