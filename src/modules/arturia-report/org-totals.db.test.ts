import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { personOrgAttribute } from "@/db/schema";
import {
  reset,
  type Scenario,
} from "@/modules/analytics/indicators/test-support";
import { buildReportScenario } from "@/modules/insights/test-support";
import { setOrgAttributes } from "@/modules/org-attributes/test-support";
import { buildReport } from "./build";

/**
 * The totals of the Arturia report decide per cut. The indicators scenario in
 * its second cycle has nine participants: Marta manages Ana..Fabio (the area
 * "Ingeniería", six people), Nora Gina, Hugo and Iris ("Producto", three).
 * Accounts: A has Ana..Elena (5), C has Gina, Hugo and Iris (3) and Fabio is
 * in B (1) or in C (4), per test. Everybody has the same DM.
 */
let s: Scenario;
let cycleId: string;

beforeAll(async () => {
  s = await buildReportScenario();
  cycleId = s.c2.cycleId;
  for (const who of ["ana", "bruno", "carla", "dario", "elena"] as const) {
    await setOrgAttributes(s.id[who], { account: "Cuenta A", dm: "DM Uno" });
  }
  for (const who of ["gina", "hugo", "iris"] as const) {
    await setOrgAttributes(s.id[who], { account: "Cuenta C", dm: "DM Uno" });
  }
  await setOrgAttributes(s.id.fabio, { account: "Cuenta B", dm: "DM Uno" });
}, 60_000);
afterAll(async () => {
  await reset();
  await closeDb();
});

const fabioIn = (account: string) =>
  db
    .update(personOrgAttribute)
    .set({ value: account })
    .where(
      and(
        eq(personOrgAttribute.personId, s.id.fabio),
        eq(personOrgAttribute.kind, "account"),
      ),
    );

describe("Arturia totals, per cut", () => {
  it("a suppressed account hides the account total, never the totals of the area and team cuts", async () => {
    await fabioIn("Cuenta B");

    const r = await buildReport(db, {
      cycle: cycleId,
      anonymized: true,
      minGroupSize: 3,
    });
    const c = r.sections.completion!;
    const retention = r.sections.indicators!.distribution[0];

    // Fabio alone in Cuenta B is under the minimum: the smallest account
    // joins him in Otros instead of leaving him out next to a public total
    // (9 - 8 would be him, #130).
    expect(c.suppressed).toMatchObject({ byAccount: 0, byDm: 0 });
    expect(retention.suppressedBy).toEqual({ account: 0, dm: 0 });
    for (const g of retention.byAccount!) expect(g.n).toBeGreaterThanOrEqual(3);
    expect(retention.byAccountTotal).toMatchObject({ n: 9 });
    expect(retention.byAccount!.reduce((n, g) => n + g.n, 0)).toBe(9);
    expect(c.byAccountTotal).not.toBeNull();
    expect(c.byRelationship).not.toBeNull();
    expect(retention.total).toMatchObject({ n: 9 });
    expect(r.sections.goals!.suppressed).toMatchObject({ byAccount: 0 });
    expect(r.sections.goals!.goals).not.toBeNull();
  });

  it("a small area is folded, not hidden: the overall totals stay (#130)", async () => {
    await fabioIn("Cuenta C");

    const r = await buildReport(db, {
      cycle: cycleId,
      anonymized: true,
      minGroupSize: 4,
    });
    const c = r.sections.completion!;
    const retention = r.sections.indicators!.distribution[0];

    // Producto (3) is under the minimum: folded with another area.
    expect(c.suppressed.byDepartment).toBe(0);
    expect(retention.suppressed).toBe(0);
    expect(retention.total).toMatchObject({ n: 9 });
    expect(retention.groups.reduce((n, g) => n + g.n, 0)).toBe(9);
    // Cuenta A (5) and Cuenta C (4) both reach it: nothing suppressed there.
    expect(c.suppressed.byAccount).toBe(0);
    expect(c.byAccountTotal).toEqual([
      { relationship: "self", total: 4, submitted: 3, applicable: true },
      { relationship: "manager", total: 9, submitted: 9, applicable: true },
    ]);
    expect(retention.suppressedBy).toEqual({ account: 0, dm: 0 });
    expect(retention.byAccountTotal).toMatchObject({ n: 9 });
    expect(r.sections.goals!.byAccountTotal).toMatchObject({ goals: 0 });
  });

  it("the named report has every total: nothing is suppressed", async () => {
    await fabioIn("Cuenta B");

    const r = await buildReport(db, { cycle: cycleId, anonymized: false });
    const c = r.sections.completion!;

    expect(c.byAccountTotal).not.toBeNull();
    expect(c.byDmTotal).not.toBeNull();
    expect(c.byRelationship).not.toBeNull();
    for (const d of r.sections.indicators!.distribution) {
      expect(d.byAccountTotal).not.toBeNull();
      expect(d.byDmTotal).not.toBeNull();
    }
  });
});
