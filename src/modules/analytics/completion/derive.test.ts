import { describe, expect, it } from "vitest";
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
