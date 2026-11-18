// qual (#117): the comments drill (any Feedback scope) and the DM card drill
// of the 360, with their authorization.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  as,
  direction,
  hr,
  names,
  reset,
  type Scenario,
} from "@/modules/analytics/indicators/test-support";
import { setOrgAttributes } from "@/modules/org-attributes/test-support";
import { drillRecords } from "./drill";
import type { Drill } from "./drill-spec";
import { buildReportScenario } from "./test-support";

let s: Scenario;
beforeAll(async () => {
  s = await buildReportScenario();
  for (const who of ["ana", "bruno", "carla", "dario", "elena"] as const) {
    await setOrgAttributes(
      s.id[who],
      { dm: names.marta },
      { refs: { dm: s.id.marta } },
    );
  }
  for (const who of ["fabio", "gina", "hugo"] as const) {
    await setOrgAttributes(
      s.id[who],
      { dm: names.nora },
      { refs: { dm: s.id.nora } },
    );
  }
}, 60_000);
afterAll(async () => {
  await reset();
  await closeDb();
});

const drillAs = (actor: Parameters<typeof drillRecords>[1], drill: Drill) =>
  drillRecords(db, actor, { cycleId: s.c2.cycleId, drill, minGroupSize: 5 });

describe("drillRecords: comments with a scope", () => {
  it("People: a sentiment of a cycle, with the counts and the Feedback link", async () => {
    const r = await drillAs(hr, {
      kind: "comments",
      scope: { cycle: s.c2.cycleId, sentiment: "negative" },
    });
    expect(r.unit).toBe("comments");
    expect(r.total).toBe(1);
    expect(r.comments?.map((c) => c.text)).toEqual([
      "Llego tarde, es un problema.",
    ]);
    expect(r.breakdown).toEqual([{ key: "negative", others: false, n: 1 }]);
    expect(r.moreHref).toBe(
      `/insights/qualitative?cycle=${s.c2.cycleId}&sentiment=negative`,
    );
  });

  it("People: the comments of the people a manager rated 2 on retention", async () => {
    const r = await drillAs(hr, {
      kind: "comments",
      scope: { cycle: s.c2.cycleId, role: "retention", value: 2 },
    });
    expect(new Set(r.comments?.map((c) => c.personName))).toEqual(
      new Set([names.ana, names.bruno]),
    );
    expect(r.total).toBe(4);
  });

  it("a manager: only their direct reports' comments", async () => {
    const r = await drillAs(as(s.id.nora, "manager"), {
      kind: "comments",
      scope: {},
    });
    expect(r.comments).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("direction: counts only, nothing under the minimum", async () => {
    const r = await drillAs(direction, { kind: "comments", scope: {} });
    expect(r.comments).toBeNull();
    // Three people wrote: under 5, hidden.
    expect(r.total).toBeNull();
    expect(r.breakdown).toEqual([]);
    expect(JSON.stringify(r)).not.toContain(names.ana);
  });
});

describe("drillRecords: a DM card of the 360", () => {
  it("People: the card's people at risk, with retention, and its comments", async () => {
    const risk = await drillAs(hr, {
      kind: "dm",
      dm: names.marta,
      metric: "risk",
    });
    expect(risk.people?.map((p) => p.name)).toEqual([names.bruno]);
    const retention = await drillAs(hr, {
      kind: "dm",
      dm: names.marta,
      metric: "retention",
    });
    expect(retention.people?.map((p) => p.name)).toEqual([
      names.ana,
      names.bruno,
      names.carla,
      names.dario,
      names.elena,
    ]);
    const comments = await drillAs(hr, {
      kind: "dm",
      dm: names.nora,
      metric: "comments",
    });
    expect(comments.total).toBe(0);
  });

  it("a manager: the card's people among their direct reports", async () => {
    const r = await drillAs(as(s.id.nora, "manager"), {
      kind: "dm",
      dm: names.marta,
      metric: "retention",
    });
    expect(r.people?.every((p) => p.managerName === names.nora)).toBe(true);
  });

  it("direction never drills into a DM (its cards carry no name)", async () => {
    await expect(
      drillAs(direction, { kind: "dm", dm: names.marta, metric: "risk" }),
    ).rejects.toThrow();
  });
});
