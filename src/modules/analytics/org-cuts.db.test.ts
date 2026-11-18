import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  as,
  direction,
  hr,
  reset,
  type Scenario,
} from "@/modules/analytics/indicators/test-support";
import { executiveReport } from "@/modules/insights/executive";
import { buildReportScenario } from "@/modules/insights/test-support";
import { opaqueKey } from "@/modules/org-attributes/kinds";
import { orgFilterOptions } from "@/modules/org-attributes/options";
import { setOrgAttributes } from "@/modules/org-attributes/test-support";
import {
  sentimentByGroup,
  sentimentTotals,
} from "@/modules/qualitative-analysis";
import { ReviewError } from "@/modules/review-core/review-errors";
import { completionSummary } from "./completion";
import { goalInsights, goalKpis } from "./goals-insights";
import {
  indicatorDistribution,
  indicatorOverview,
  riskMatrix,
} from "./indicators";
import { indicatorSnapshot } from "./indicators/queries";

/**
 * The org cuts (account, project, DM, Santex Lead) in every module, over the
 * indicators scenario with its labeled comments (C2 has 9 participants):
 *
 *   Cuenta A, DM Diego:  Ana, Bruno, Carla, Dario (+ Elena for the DM only)
 *   Cuenta B, DM Dora:   Fabio, Gina, Hugo   (Elena: Cuenta B, DM Diego)
 *   Iris: nothing
 * Retention in C2: Ana 2, Bruno 2, Carla 5, Dario 3, Elena 4, Fabio 1,
 * Gina 2, Hugo 4, Iris 5.
 */
let s: Scenario;
let cycleId: string;

beforeAll(async () => {
  s = await buildReportScenario();
  cycleId = s.c2.cycleId;
  const set = (
    who: keyof Scenario["id"],
    attrs: Parameters<typeof setOrgAttributes>[1],
  ) => setOrgAttributes(s.id[who], attrs);
  for (const who of ["ana", "bruno", "carla", "dario"] as const) {
    await set(who, {
      account: "Cuenta A",
      project: "Proyecto A1",
      dm: "Diego",
      santex_lead: "Lía",
    });
  }
  await set("elena", {
    account: "Cuenta B",
    project: "Proyecto B1",
    dm: "Diego",
    santex_lead: "Lía",
  });
  for (const who of ["fabio", "gina", "hugo"] as const) {
    await set(who, {
      account: "Cuenta B",
      project: "Proyecto B1",
      dm: "Dora",
      santex_lead: "Lía",
    });
  }
}, 60_000);
afterAll(async () => {
  await reset();
  await closeDb();
});

const marta = () => as(s.id.marta, "manager");
const labels = (groups: { label: string | null }[]) =>
  groups.map((g) => g.label);

describe("completion", () => {
  it("groups by account, project, DM and Santex Lead, the unassigned last", async () => {
    const by = async (groupBy: "account" | "project" | "dm" | "santex_lead") =>
      (await completionSummary(db, hr, { cycleId, groupBy })).groups.map(
        (g) => [g.label, g.participants],
      );

    expect(await by("account")).toEqual([
      ["Cuenta A", 4],
      ["Cuenta B", 4],
      [null, 1],
    ]);
    expect(await by("project")).toEqual([
      ["Proyecto A1", 4],
      ["Proyecto B1", 4],
      [null, 1],
    ]);
    expect(await by("dm")).toEqual([
      ["Diego", 5],
      ["Dora", 3],
      [null, 1],
    ]);
    expect(await by("santex_lead")).toEqual([
      ["Lía", 8],
      [null, 1],
    ]);
  });

  it("filters by each attribute and by several", async () => {
    const n = async (filters: Parameters<typeof completionSummary>[2]) =>
      (await completionSummary(db, hr, { ...filters, groupBy: "none" }))
        .participants;

    expect(await n({ cycleId, account: "Cuenta A" })).toBe(4);
    expect(await n({ cycleId, project: "Proyecto B1" })).toBe(4);
    expect(await n({ cycleId, dm: "Dora" })).toBe(3);
    expect(await n({ cycleId, santexLead: "Lía" })).toBe(8);
    expect(await n({ cycleId, account: "Cuenta B", dm: "Diego" })).toBe(1);
    expect(await n({ cycleId, account: "Nada" })).toBe(0);
  });

  it("a manager reads only their direct reports, whatever the cut", async () => {
    const summary = await completionSummary(db, marta(), {
      cycleId,
      groupBy: "account",
    });

    // Marta's team: Ana, Bruno, Carla, Dario, Elena, Fabio.
    expect(summary.participants).toBe(6);
    expect(summary.groups.map((g) => [g.label, g.participants])).toEqual([
      ["Cuenta A", 4],
      ["Cuenta B", 2],
    ]);
    const dora = await completionSummary(db, marta(), {
      cycleId,
      groupBy: "none",
      dm: "Dora",
    });
    expect(dora.participants).toBe(1);
  });

  it("direction reads folded aggregates: small groups fold, DMs are teams without a name, no filters", async () => {
    const byAccount = await completionSummary(db, direction, {
      cycleId,
      groupBy: "account",
      minGroupSize: 4,
    });
    expect(byAccount.groups.map((g) => [g.label, g.participants])).toEqual([
      ["Cuenta A", 4],
      ["Cuenta B", 4],
    ]);
    // Iris (no account) is alone: under the minimum, hidden.
    expect(byAccount.suppressed).toBe(1);

    const byDm = await completionSummary(db, direction, {
      cycleId,
      groupBy: "dm",
      minGroupSize: 4,
    });
    expect(labels(byDm.groups)).toEqual([null]);
    expect(byDm.groups[0].key).toBe(opaqueKey("Diego"));
    // Dora's 3 and Iris' 1 fold together into 4.
    expect(byDm.others?.participants).toBe(4);
    expect(JSON.stringify(byDm)).not.toMatch(/Diego|Dora/);

    const filtered = await completionSummary(db, direction, {
      cycleId,
      groupBy: "none",
      account: "Cuenta A",
      minGroupSize: 4,
    });
    expect(filtered.participants).toBe(9);
  });
});

describe("indicators", () => {
  const retention = (
    input: Partial<Parameters<typeof indicatorDistribution>[2]> = {},
    actor = hr,
  ) =>
    indicatorDistribution(db, actor, {
      cycleId,
      indicator: "retention",
      groupBy: "account",
      ...input,
    });

  it("distributes by account and by DM", async () => {
    const byAccount = await retention();
    expect(byAccount.series.map((x) => [x.label, x.n, x.counts])).toEqual([
      ["Cuenta A", 4, [0, 2, 1, 0, 1]],
      ["Cuenta B", 4, [1, 1, 0, 2, 0]],
      [null, 1, [0, 0, 0, 0, 1]],
    ]);
    const byDm = await retention({ groupBy: "dm" });
    expect(byDm.series.map((x) => [x.label, x.n])).toEqual([
      ["Diego", 5],
      ["Dora", 3],
      [null, 1],
    ]);
  });

  it("filters the distribution, the matrix and the snapshot by an attribute", async () => {
    const filters = { dm: "Dora" };
    const dist = await retention({ groupBy: "none", filters });
    const matrix = await riskMatrix(db, hr, { cycleId, filters });
    const snapshot = await indicatorSnapshot(db, hr, { cycleId, filters });

    expect(dist.total?.n).toBe(3);
    expect(dist.total?.mean).toBeCloseTo((1 + 2 + 4) / 3);
    // Fabio 1,1 and Gina 2,2 are at risk; Hugo 4,4 is not.
    expect(matrix.total).toBe(3);
    expect(matrix.riskCount).toBe(2);
    expect(snapshot.retention.total?.n).toBe(3);
    const otherFilters = await retention({
      groupBy: "none",
      filters: { account: "Cuenta A", santexLead: "Lía" },
    });
    expect(otherFilters.total?.n).toBe(4);
  });

  it("offers the values of the selects, and no DMs to direction", async () => {
    const people = await indicatorOverview(db, hr, {
      cycleId,
      indicator: "retention",
      groupBy: "account",
    });
    expect(people.options.org).toEqual({
      accounts: ["Cuenta A", "Cuenta B"],
      projects: ["Proyecto A1", "Proyecto B1"],
      dms: ["Diego", "Dora"],
      santexLeads: ["Lía"],
    });
    const masked = await indicatorOverview(db, direction, {
      cycleId,
      indicator: "retention",
      groupBy: "account",
      config: { minGroupSize: 4 },
    });
    expect(masked.options.org.accounts).toEqual(["Cuenta A", "Cuenta B"]);
    expect(masked.options.org.dms).toEqual([]);
    expect(masked.options.org.santexLeads).toEqual([]);
  });

  it("a manager's cut covers only their direct reports", async () => {
    const dist = await retention({ groupBy: "account" }, marta());
    // Marta: Ana 2, Bruno 2, Carla 5, Dario 3 (A) and Elena 4, Fabio 1 (B).
    expect(dist.series.map((x) => [x.label, x.n])).toEqual([
      ["Cuenta A", 4],
      ["Cuenta B", 2],
    ]);
  });

  it("direction: groups under the minimum fold into Otros, DMs are teams without a name", async () => {
    const byDm = await retention(
      { groupBy: "dm", config: { minGroupSize: 4 } },
      direction,
    );

    expect(byDm.series.map((x) => [x.label, x.others, x.n])).toEqual([
      [null, false, 5],
      [null, true, 4],
    ]);
    expect(byDm.series[0].key).toBe(opaqueKey("Diego"));
    expect(JSON.stringify(byDm)).not.toMatch(/Diego|Dora/);
    // Nothing is hidden: the total stays.
    expect(byDm.total?.n).toBe(9);

    const strict = await retention(
      { groupBy: "dm", config: { minGroupSize: 5 } },
      direction,
    );
    // Dora's 3 and Iris' 1 are under 5 even together: hidden, and so is the total.
    expect(strict.series.map((x) => x.n)).toEqual([5]);
    expect(strict.suppressed).toBe(4);
    expect(strict.total).toBeNull();
  });
});

describe("goals insights", () => {
  it("groups the goal figures by account, project, DM and Santex Lead and filters by them", async () => {
    const by = async (groupBy: "account" | "dm", filters = {}) =>
      (await goalKpis(db, hr, { cycleId, groupBy, filters })).groups.map(
        (g) => [g.label, g.people],
      );

    expect(await by("account")).toEqual([
      ["Cuenta A", 4],
      ["Cuenta B", 4],
      [null, 1],
    ]);
    expect(await by("dm")).toEqual([
      ["Diego", 5],
      ["Dora", 3],
      [null, 1],
    ]);
    expect(await by("account", { dm: "Diego" })).toEqual([
      ["Cuenta A", 4],
      ["Cuenta B", 1],
    ]);
    expect(
      await by("account", { santexLead: "Lía", project: "Proyecto B1" }),
    ).toEqual([["Cuenta B", 4]]);
  });

  it("offers the selects and masks direction", async () => {
    const people = await goalInsights(db, hr, { cycleId, groupBy: "account" });
    expect(people.options.org.dms).toEqual(["Diego", "Dora"]);

    const masked = await goalInsights(db, direction, {
      cycleId,
      groupBy: "dm",
      config: { minGroupSize: 4 },
    });
    expect(masked.options.org.dms).toEqual([]);
    expect(
      masked.kpis.groups.map((g) => [g.label, g.others, g.people]),
    ).toEqual([
      [null, false, 5],
      [null, true, 4],
    ]);
    expect(JSON.stringify(masked.kpis)).not.toMatch(/Diego|Dora/);
  });

  it("direction never groups by person, but may by an attribute", async () => {
    const error = await goalKpis(db, direction, {
      cycleId,
      groupBy: "person",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReviewError);
    await expect(
      goalKpis(db, direction, {
        cycleId,
        groupBy: "account",
        config: { minGroupSize: 4 },
      }),
    ).resolves.toMatchObject({ groupBy: "account" });
  });
});

describe("qualitative analysis", () => {
  // C2's comments: Ana 2 (positive, positive), Bruno 2 (positive, constructive),
  // Carla 1 (negative).
  it("counts sentiment per account, project, DM, Santex Lead and area, with the people behind each", async () => {
    const byAccount = await sentimentByGroup(db, hr, { cycleId }, "account");
    expect(byAccount).toEqual([
      expect.objectContaining({
        key: "Cuenta A",
        label: "Cuenta A",
        participants: 3,
        total: 5,
        positive: 3,
        constructive: 1,
        negative: 1,
      }),
    ]);
    const byDm = await sentimentByGroup(db, hr, { cycleId }, "dm");
    expect(byDm.map((g) => [g.label, g.total])).toEqual([["Diego", 5]]);
    const byDepartment = await sentimentByGroup(
      db,
      hr,
      { cycleId },
      "department",
    );
    expect(byDepartment.map((g) => [g.label, g.total])).toEqual([
      ["Ingeniería", 5],
    ]);
  });

  it("only groups by what it knows (the column is part of the statement)", async () => {
    await expect(
      sentimentByGroup(db, hr, { cycleId }, "1; drop table person" as never),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("filters the totals by an attribute", async () => {
    expect(
      (await sentimentTotals(db, hr, { cycleId, account: "Cuenta A" }))?.total,
    ).toBe(5);
    expect(
      (await sentimentTotals(db, hr, { cycleId, account: "Cuenta B" }))?.total,
    ).toBe(0);
    expect(
      (await sentimentTotals(db, hr, { cycleId, dm: "Dora" }))?.total,
    ).toBe(0);
    expect(
      (
        await sentimentTotals(db, hr, {
          cycleId,
          project: "Proyecto A1",
          santexLead: "Lía",
        })
      )?.total,
    ).toBe(5);
  });

  it("a manager only counts the comments about their direct reports", async () => {
    const nora = as(s.id.nora, "manager");
    expect(await sentimentByGroup(db, nora, { cycleId }, "account")).toEqual(
      [],
    );
    expect(
      await sentimentByGroup(db, marta(), { cycleId }, "account"),
    ).toHaveLength(1);
  });

  it("direction: groups under the minimum are left out and a DM is a team, never a name", async () => {
    const group = (min: number, by: "account" | "dm") =>
      sentimentByGroup(db, direction, { cycleId, minGroupSize: min }, by);

    const visible = await group(3, "dm");
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      label: null,
      key: opaqueKey("Diego"),
      participants: 3,
    });
    expect(JSON.stringify(visible)).not.toContain("Diego");
    expect(await group(4, "dm")).toEqual([]);
    expect((await group(3, "account"))[0].label).toBe("Cuenta A");
  });
});

describe("executive report", () => {
  it("narrows every block of People's view to an attribute", async () => {
    const all = await executiveReport(db, hr, { cycleId, mode: "both" });
    const a = await executiveReport(db, hr, {
      cycleId,
      mode: "both",
      filters: { account: "Cuenta A" },
    });
    const b = await executiveReport(db, hr, {
      cycleId,
      mode: "both",
      filters: { dm: "Dora" },
    });

    expect(all.completion.participants).toBe(9);
    expect(a.completion.participants).toBe(4);
    expect(a.retention).toMatchObject({ n: 4, counts: [0, 2, 1, 0, 1] });
    expect(a.sentiment?.[0].total).toBe(5);
    expect(a.themes?.length).toBeGreaterThan(0);
    expect(b.completion.participants).toBe(3);
    expect(b.retention?.n).toBe(3);
    expect(b.sentiment).toEqual([]);
  });

  it("direction reads the whole cycle: the filters are People's", async () => {
    const r = await executiveReport(db, direction, {
      cycleId,
      mode: "both",
      minGroupSize: 4,
      filters: { account: "Cuenta A" },
    });

    expect(r.completion.participants).toBe(9);
    expect(r.retention?.n).toBe(9);
  });
});

describe("filter options", () => {
  it("lists what the actor reads: People all, a manager their reports, direction no people", async () => {
    expect(await orgFilterOptions(db, hr, { cycleId })).toEqual({
      accounts: ["Cuenta A", "Cuenta B"],
      projects: ["Proyecto A1", "Proyecto B1"],
      dms: ["Diego", "Dora"],
      santexLeads: ["Lía"],
    });
    expect((await orgFilterOptions(db, marta(), { cycleId })).dms).toEqual([
      "Diego",
      "Dora",
    ]);
    expect(await orgFilterOptions(db, direction, { cycleId })).toEqual({
      accounts: ["Cuenta A", "Cuenta B"],
      projects: ["Proyecto A1", "Proyecto B1"],
      dms: [],
      santexLeads: [],
    });
    await expect(
      orgFilterOptions(
        db,
        { personId: s.id.ana, role: "employee" },
        { cycleId },
      ),
    ).rejects.toBeInstanceOf(ReviewError);
  });
});
