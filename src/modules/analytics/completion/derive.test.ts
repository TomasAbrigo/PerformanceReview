import { describe, expect, it } from "vitest";
import { noOrgDims } from "@/modules/org-attributes/kinds";
import { countsOf, missingOf, type SideRow, summarize } from "./derive";
import type { SideStatus } from "./types";

let n = 0;
const row = (
  department: string | null,
  manager: string | null,
  self: SideStatus,
  managerSide: SideStatus,
  source: SideRow["source"] = "progress",
): SideRow => ({
  participantId: `cp${++n}`,
  personId: `p${n}`,
  name: `Persona ${n}`,
  department,
  managerId: manager && `id-${manager}`,
  managerName: manager,
  source,
  selfStatus: self,
  managerStatus: managerSide,
  hasNotes: false,
  ...noOrgDims,
});

const rows = [
  row("Ventas", "Nico", "submitted", "submitted"),
  row("Ventas", "Nico", "submitted", "in_progress"),
  row("Ventas", "Marta", "not_started", "not_applicable", "requests"),
  row("Tecnología", "Marta", "submitted", "submitted"),
  row("Álvaro Unidad", "Marta", "not_applicable", "not_started"),
  row(null, null, "in_progress", "submitted", "requests"),
];

describe("countsOf", () => {
  it("counts submitted and applicable sides apart", () => {
    expect(countsOf(rows)).toEqual({
      participants: 6,
      selfSubmitted: 3,
      selfApplicable: 5,
      managerSubmitted: 3,
      managerApplicable: 5,
    });
    expect(countsOf([])).toEqual({
      participants: 0,
      selfSubmitted: 0,
      selfApplicable: 0,
      managerSubmitted: 0,
      managerApplicable: 0,
    });
  });
});

describe("summarize", () => {
  it("groups by department in order, the unassigned one last", () => {
    const s = summarize(rows, { groupBy: "department", minGroupSize: null });
    expect(s.groups.map((g) => g.label)).toEqual([
      "Álvaro Unidad",
      "Tecnología",
      "Ventas",
      null,
    ]);
    expect(s.groups[2]).toMatchObject({
      key: "Ventas",
      participants: 3,
      selfSubmitted: 2,
      selfApplicable: 3,
      managerSubmitted: 1,
      managerApplicable: 2,
    });
    expect(s.sources).toEqual({ progress: 4, requests: 2 });
    expect(s.total?.participants).toBe(6);
  });

  it("groups by manager id, and none gives only the total", () => {
    const s = summarize(rows, { groupBy: "manager", minGroupSize: null });
    expect(s.groups.map((g) => [g.key, g.label])).toEqual([
      ["id-Marta", "Marta"],
      ["id-Nico", "Nico"],
      [null, null],
    ]);
    expect(
      summarize(rows, { groupBy: "none", minGroupSize: null }).groups,
    ).toEqual([]);
  });

  it("folds the groups under the minimum into Otros, hides it when it is under it too", () => {
    const three = summarize(rows, { groupBy: "department", minGroupSize: 3 });
    expect(three.groups.map((g) => g.label)).toEqual(["Ventas"]);
    // Álvaro Unidad, Tecnología and the unassigned one: 3 people.
    expect(three.others?.participants).toBe(3);
    expect(three.suppressed).toBe(0);
    const four = summarize(rows, { groupBy: "department", minGroupSize: 4 });
    expect(four.groups).toEqual([]);
    expect(four.others?.participants).toBe(6);
    const five = summarize(
      [...rows, row("Ventas", "Nico", "submitted", "submitted")],
      { groupBy: "department", minGroupSize: 4 },
    );
    expect(five.groups.map((g) => g.label)).toEqual(["Ventas"]);
    expect(five.others).toBeNull();
    expect(five.suppressed).toBe(3);
  });

  it("a manager is a person: with a minimum the teams keep their key but not their name", () => {
    const s = summarize(rows, { groupBy: "manager", minGroupSize: 3 });
    // Marta leads 3 people, Nico 2 and the unassigned one 1: both fold into "Otros".
    expect(s.groups.map((g) => [g.key, g.label, g.participants])).toEqual([
      ["id-Marta", null, 3],
    ]);
    expect(s.others).toMatchObject({ key: null, label: null, participants: 3 });
    const all = summarize(rows, { groupBy: "manager", minGroupSize: 2 });
    expect(all.groups.map((g) => [g.key, g.label])).toEqual([
      ["id-Marta", null],
      ["id-Nico", null],
    ]);
    // areas keep their names: they are not people
    expect(
      summarize(rows, { groupBy: "department", minGroupSize: 3 }).groups[0]
        .label,
    ).toBe("Ventas");
  });

  it("under the minimum gives only the head count", () => {
    const s = summarize(rows, { groupBy: "department", minGroupSize: 7 });
    expect(s).toMatchObject({
      participants: 6,
      total: null,
      groups: [],
      others: null,
      suppressed: 6,
      sources: { progress: 0, requests: 0 },
    });
  });
});

describe("missingOf", () => {
  it("keeps the order and drops sides that are not missing or do not apply", () => {
    expect(missingOf(rows).map((r) => r.participantId)).toEqual([
      rows[1].participantId,
      rows[2].participantId,
      rows[4].participantId,
      rows[5].participantId,
    ]);
    expect(missingOf(rows, "self_missing")).toEqual([rows[2], rows[5]]);
    expect(missingOf(rows, "manager_missing")).toEqual([rows[1], rows[4]]);
  });
});

describe("summarize by an org attribute", () => {
  const org = (account: string | null, dm: string | null, n = 1): SideRow[] =>
    Array.from({ length: n }, () => ({
      ...row("Ventas", "Nico", "submitted", "submitted"),
      account,
      dm,
    }));
  const orgRows = [
    ...org("Cuenta A", "Ana Prieto", 3),
    ...org("Cuenta B", "Bruno Soler", 2),
    ...org(null, null, 1),
  ];

  it("groups by account in order, with the value as key and label, the unassigned one last", () => {
    const s = summarize(orgRows, { groupBy: "account", minGroupSize: null });

    expect(s.groups.map((g) => [g.key, g.label, g.participants])).toEqual([
      ["Cuenta A", "Cuenta A", 3],
      ["Cuenta B", "Cuenta B", 2],
      [null, null, 1],
    ]);
  });

  it("names DMs to People, but gives direction teams with an opaque key and no name", () => {
    const people = summarize(orgRows, { groupBy: "dm", minGroupSize: null });
    const direction = summarize(orgRows, { groupBy: "dm", minGroupSize: 2 });

    expect(people.groups.map((g) => g.label)).toEqual([
      "Ana Prieto",
      "Bruno Soler",
      null,
    ]);
    expect(direction.groups.map((g) => [g.label, g.participants])).toEqual([
      [null, 3],
      [null, 2],
    ]);
    const keys = direction.groups.map((g) => g.key);
    expect(new Set(keys).size).toBe(2);
    expect(JSON.stringify(direction)).not.toMatch(/Ana|Bruno/);
    // Teams under the minimum and the unassigned one are folded or hidden.
    expect(direction.suppressed).toBe(1);
  });

  it("folds small accounts into Otros for direction, like areas", () => {
    const s = summarize(orgRows, { groupBy: "account", minGroupSize: 3 });

    expect(s.groups.map((g) => g.label)).toEqual(["Cuenta A"]);
    expect(s.others?.participants).toBe(3);
  });
});
