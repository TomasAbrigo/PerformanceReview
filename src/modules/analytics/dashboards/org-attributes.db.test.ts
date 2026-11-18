import { type SQL, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  as,
  buildScenario,
  hr,
  reset,
  type Scenario,
} from "@/modules/analytics/indicators/test-support";
import {
  insertOrgAttribute,
  setOrgAttributes,
} from "@/modules/org-attributes/test-support";
import { scopedCtes } from "./scope";
import type { DashboardFilters } from "./types";

let s: Scenario;
beforeEach(async () => {
  s = await buildScenario();
});
afterAll(async () => {
  await reset();
  await closeDb();
});

type Row = {
  person_id: string;
  cycle_id: string;
  account: string | null;
  project: string | null;
  dm: string | null;
  santex_lead: string | null;
  dm_ref_person_id: string | null;
};
const scoped = (
  actor: Parameters<typeof scopedCtes>[0],
  f: Partial<DashboardFilters> = {},
  extra: SQL = sql``,
) =>
  db.execute<Row>(sql`
    with recursive ${scopedCtes(actor, { hierarchy: "asOf", ...f })}
    select * from scoped ${extra}`);

const accountOf = async (
  who: keyof Scenario["id"],
  f: Partial<DashboardFilters> = {},
) => {
  const rows = await scoped(hr, { cycleId: s.c1.cycleId, ...f });
  return rows.find((r) => r.person_id === s.id[who])?.account;
};

describe("scopedCtes: org attributes as of the cycle snapshot", () => {
  it("carries account, project, dm and santex_lead of each participant, null when they have none", async () => {
    await setOrgAttributes(
      s.id.ana,
      {
        account: "Cuenta A",
        project: "Proyecto A1",
        dm: "Marta Quiroga",
        santex_lead: "Nora Salas",
      },
      { refs: { dm: s.id.marta } },
    );

    const rows = await scoped(hr, { cycleId: s.c1.cycleId });

    const ana = rows.find((r) => r.person_id === s.id.ana)!;
    expect(ana).toMatchObject({
      account: "Cuenta A",
      project: "Proyecto A1",
      dm: "Marta Quiroga",
      santex_lead: "Nora Salas",
      dm_ref_person_id: s.id.marta,
    });
    const bruno = rows.find((r) => r.person_id === s.id.bruno)!;
    expect(bruno).toMatchObject({
      account: null,
      project: null,
      dm: null,
      santex_lead: null,
      dm_ref_person_id: null,
    });
  });

  it("reads the value held on the snapshot date (both ends of the validity included)", async () => {
    // Snapshot of the test participants: 2025-06-01.
    await insertOrgAttribute({
      personId: s.id.ana,
      kind: "account",
      value: "Antes",
      validFrom: "2020-01-01",
      validTo: "2025-05-31",
    });
    await insertOrgAttribute({
      personId: s.id.ana,
      kind: "account",
      value: "Ese día",
      validFrom: "2025-06-01",
      validTo: "2025-06-01",
    });
    await insertOrgAttribute({
      personId: s.id.ana,
      kind: "account",
      value: "Después",
      validFrom: "2025-06-02",
    });
    await insertOrgAttribute({
      personId: s.id.bruno,
      kind: "account",
      value: "Hasta ese día",
      validFrom: "2020-01-01",
      validTo: "2025-06-01",
    });
    await insertOrgAttribute({
      personId: s.id.carla,
      kind: "account",
      value: "Desde ese día",
      validFrom: "2025-06-01",
    });
    await insertOrgAttribute({
      personId: s.id.dario,
      kind: "account",
      value: "Todavía no",
      validFrom: "2025-06-02",
    });
    await insertOrgAttribute({
      personId: s.id.elena,
      kind: "account",
      value: "Ya no",
      validFrom: "2020-01-01",
      validTo: "2025-05-31",
    });

    expect(await accountOf("ana")).toBe("Ese día");
    expect(await accountOf("bruno")).toBe("Hasta ese día");
    expect(await accountOf("carla")).toBe("Desde ese día");
    expect(await accountOf("elena")).toBeNull();
    const c2 = await scoped(hr, { cycleId: s.c2.cycleId });
    expect(c2.find((r) => r.person_id === s.id.dario)?.account).toBeNull();
  });

  it("with the current hierarchy reads today's value instead", async () => {
    await insertOrgAttribute({
      personId: s.id.ana,
      kind: "account",
      value: "Vieja",
      validFrom: "2020-01-01",
      validTo: "2025-05-31",
    });
    await insertOrgAttribute({
      personId: s.id.ana,
      kind: "account",
      value: "Actual",
      validFrom: "2025-06-01",
    });
    await insertOrgAttribute({
      personId: s.id.ana,
      kind: "project",
      value: "Vencido",
      validFrom: "2020-01-01",
      validTo: "2025-05-31",
    });

    const asOf = await accountOf("ana");
    const current = await accountOf("ana", { hierarchy: "current" });
    const projectNow = (
      await scoped(hr, { cycleId: s.c1.cycleId, hierarchy: "current" })
    ).find((r) => r.person_id === s.id.ana)?.project;

    expect(asOf).toBe("Actual");
    expect(current).toBe("Actual");
    expect(projectNow).toBeNull();
    await insertOrgAttribute({
      personId: s.id.bruno,
      kind: "account",
      value: "Cerrada",
      validFrom: "2020-01-01",
      validTo: "2025-06-01",
    });
    expect(await accountOf("bruno")).toBe("Cerrada");
    expect(await accountOf("bruno", { hierarchy: "current" })).toBeNull();
  });

  it("takes the latest start when two rows overlap and ignores soft-deleted rows", async () => {
    await insertOrgAttribute({
      personId: s.id.ana,
      kind: "account",
      value: "Vieja",
      validFrom: "2020-01-01",
    });
    await insertOrgAttribute({
      personId: s.id.ana,
      kind: "account",
      value: "Nueva",
      validFrom: "2025-01-01",
    });
    await insertOrgAttribute({
      personId: s.id.ana,
      kind: "account",
      value: "Borrada",
      validFrom: "2025-03-01",
      deleted: true,
    });

    expect(await accountOf("ana")).toBe("Nueva");
  });

  it("filters by account, project, dm and santex lead, each on its own and together", async () => {
    await setOrgAttributes(s.id.ana, {
      account: "A",
      project: "A1",
      dm: "D1",
      santex_lead: "L1",
    });
    await setOrgAttributes(s.id.bruno, {
      account: "A",
      project: "A2",
      dm: "D1",
      santex_lead: "L2",
    });
    await setOrgAttributes(s.id.carla, {
      account: "B",
      project: "B1",
      dm: "D2",
      santex_lead: "L1",
    });
    const who = async (f: Partial<DashboardFilters>) =>
      (await scoped(hr, { cycleId: s.c1.cycleId, ...f }))
        .map((r) => r.person_id)
        .sort();
    const ids = (...names: (keyof Scenario["id"])[]) =>
      names.map((n) => s.id[n]).sort();

    expect(await who({ account: "A" })).toEqual(ids("ana", "bruno"));
    expect(await who({ project: "A2" })).toEqual(ids("bruno"));
    expect(await who({ dm: "D2" })).toEqual(ids("carla"));
    expect(await who({ santexLead: "L1" })).toEqual(ids("ana", "carla"));
    expect(await who({ account: "A", santexLead: "L1" })).toEqual(ids("ana"));
    expect(await who({ account: "Z" })).toEqual([]);
  });

  it("still restricts a manager to their direct reports, whatever the filter", async () => {
    await setOrgAttributes(s.id.ana, { account: "A" });
    await setOrgAttributes(s.id.gina, { account: "A" });

    const marta = await scoped(as(s.id.marta, "manager"), {
      cycleId: s.c1.cycleId,
      account: "A",
    });
    const nora = await scoped(as(s.id.nora, "manager"), {
      cycleId: s.c1.cycleId,
      account: "A",
    });

    expect(marta.map((r) => r.person_id)).toEqual([s.id.ana]);
    expect(nora.map((r) => r.person_id)).toEqual([s.id.gina]);
  });
});
