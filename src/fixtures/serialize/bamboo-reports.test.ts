import { describe, expect, it } from "vitest";
import { generateCompany, type CompanyFixture } from "../company";
import { parseCsv } from "./csv";
import type { FixtureFile } from "./files";
import { serializeBambooReports } from "./bamboo-reports";

const small = generateCompany({ size: "small", seed: 1001 });
const demo = generateCompany({ size: "demo", seed: 2002 });
const smallFiles = serializeBambooReports(small);
const demoFiles = serializeBambooReports(demo);

type Row = Record<string, string>;

function table(files: FixtureFile[], path: string): { header: string[]; rows: Row[] } {
  const file = files.find((f) => f.path === path);
  if (!file) throw new Error(`missing report ${path}`);
  const [header, ...body] = parseCsv(file.content);
  return {
    header,
    rows: body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i]]))),
  };
}

const fullName = (e: { firstName: string; lastName: string }) =>
  `${e.firstName} ${e.lastName}`;

/** The name a report printed for someone in a cycle (spec of the noise rules). */
function nameInCycle(c: CompanyFixture, employeeId: string, cycle: number): string {
  const typo = c.identity.misspellings.find(
    (m) => m.employeeId === employeeId && m.cycle === cycle,
  );
  if (typo) return typo.csvName;
  const rename = c.identity.renames.find((r) => r.employeeId === employeeId);
  if (rename && c.cycles[cycle].assessmentDue < rename.renamedOn) {
    return `${rename.previousFirstName} ${rename.previousLastName}`;
  }
  return fullName(c.employees.find((e) => e.id === employeeId)!);
}

describe("employee-performance.csv", () => {
  it.each([
    ["small", small, smallFiles],
    ["demo", demo, demoFiles],
  ])("%s has the standard columns, 2 custom questions and no ids", (_, c, files) => {
    const { header } = table(files, "employee-performance.csv");
    expect(header.slice(0, 5)).toEqual([
      "Employee Name",
      "Manager",
      "Department",
      "Review Cycle",
      "Assessment Date",
    ]);
    const questions = header.slice(5);
    expect(questions).toHaveLength(12);
    expect(questions.filter((q) => q.startsWith("Employee Q"))).toHaveLength(4);
    expect(questions.filter((q) => q.startsWith("Manager Q"))).toHaveLength(4);
    expect(questions.filter((q) => /Custom Q/.test(q))).toHaveLength(4);
    expect(questions.join("|")).toContain("recognize my value");
    expect(questions.join("|")).toContain("job offer elsewhere");
    expect(questions.join("|")).toContain("How engaged is [Employee] at work?");
    expect(header.some((h) => /\bid\b/i.test(h))).toBe(false);
    expect(c.cycles).toHaveLength(3);
  });

  it.each([
    ["small", small, smallFiles],
    ["demo", demo, demoFiles],
  ])("%s covers the 3 cycles with letter-coded and 1-5 answers", (_, c, files) => {
    const { header, rows } = table(files, "employee-performance.csv");
    expect(new Set(rows.map((r) => r["Review Cycle"]))).toEqual(
      new Set(c.cycles.map((cycle) => cycle.name)),
    );
    const col = (prefix: string) => header.find((h) => h.startsWith(prefix))!;
    for (const row of rows) {
      expect("ABCD").toContain(row[col("Employee Q1:")]);
      expect("ABCDE").toContain(row[col("Employee Q2:")]);
      expect("ABCDE").toContain(row[col("Manager Q1:")]);
      expect("ABCDE").toContain(row[col("Manager Q2:")]);
      expect(row[col("Employee Q3:")].length).toBeGreaterThan(0);
      expect(row[col("Manager Q4:")].length).toBeGreaterThan(0);
      for (const custom of header.filter((h) => /Custom Q/.test(h))) {
        expect(row[custom]).toMatch(/^[1-5]$/);
      }
      expect(row["Assessment Date"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const completed = c.assessments.filter(
      (a) => a.selfStatus === "Submitted" && a.managerStatus === "Submitted",
    );
    expect(rows).toHaveLength(completed.length);
  });

  it.each([
    ["small", small, smallFiles],
    ["demo", demo, demoFiles],
  ])("%s shows names only, with the CURRENT manager and department", (_, c, files) => {
    const { rows } = table(files, "employee-performance.csv");
    const byId = new Map(c.employees.map((e) => [e.id, e]));
    const completed = c.assessments.filter(
      (a) =>
        a.employeeId !== null &&
        a.selfStatus === "Submitted" &&
        a.managerStatus === "Submitted",
    );
    for (const a of completed) {
      const employee = byId.get(a.employeeId!)!;
      const manager = byId.get(employee.managerId!)!;
      const cycleName = c.cycles[a.cycle].name;
      const match = rows.filter(
        (r) =>
          r["Review Cycle"] === cycleName &&
          r["Manager"] === fullName(manager) &&
          r["Department"] === employee.department &&
          r["Assessment Date"] === a.managerSubmittedOn,
      );
      expect(match.length, `row for ${employee.id} in ${cycleName}`).toBeGreaterThan(0);
    }
  });
});

describe("feedback-status.csv", () => {
  it.each([
    ["small", small, smallFiles],
    ["demo", demo, demoFiles],
  ])("%s lists who gives feedback to whom, per cycle, by name", (_, c, files) => {
    const { header, rows } = table(files, "feedback-status.csv");
    expect(header).toEqual([
      "Employee Name",
      "Receiving Feedback From",
      "Date Completed",
      "Due Date",
      "Review Cycle",
    ]);
    expect(new Set(rows.map((r) => r["Review Cycle"]))).toEqual(
      new Set(c.cycles.map((cycle) => cycle.name)),
    );
    expect(rows).toHaveLength(c.feedback.length);
    for (const f of c.feedback.filter((x) => x.reviewerId !== null)) {
      const match = rows.filter(
        (r) =>
          r["Employee Name"] === nameInCycle(c, f.employeeId, f.cycle) &&
          r["Receiving Feedback From"] === nameInCycle(c, f.reviewerId!, f.cycle) &&
          r["Due Date"] === f.dueDate &&
          r["Date Completed"] === (f.completedOn ?? "") &&
          r["Review Cycle"] === c.cycles[f.cycle].name,
      );
      expect(match.length).toBeGreaterThan(0);
    }
    expect(rows.some((r) => r["Date Completed"] === "")).toBe(true);
  });
});

describe("goal-status.csv", () => {
  it.each([
    ["small", small, smallFiles],
    ["demo", demo, demoFiles],
  ])("%s has one row per goal of active people plus No Goals Set rows", (_, c, files) => {
    const { header, rows } = table(files, "goal-status.csv");
    expect(header).toEqual([
      "Employee Name",
      "Manager",
      "Department",
      "Goal",
      "Due Date",
      "Progress",
      "Status",
      "Last Comment",
    ]);
    const active = c.employees.filter((e) => e.status === "Active");
    const activeIds = new Set(active.map((e) => e.id));
    const goals = c.goals.filter((g) => activeIds.has(g.employeeId));
    const owners = new Set(goals.map((g) => g.employeeId));
    const withoutGoals = active.filter((e) => !owners.has(e.id));
    expect(rows).toHaveLength(goals.length + withoutGoals.length);
    expect(withoutGoals.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r["Status"] === "No Goals Set")).toHaveLength(withoutGoals.length);

    const labels = new Set(rows.map((r) => r["Status"]));
    for (const label of ["In Progress", "Completed", "Past Due", "No Goals Set"]) {
      expect(labels.has(label), label).toBe(true);
    }
    for (const year of ["2023", "2024", "2025"]) {
      expect(rows.some((r) => r["Due Date"].startsWith(year))).toBe(true);
    }
    const byId = new Map(c.employees.map((e) => [e.id, e]));
    for (const g of goals) {
      const owner = byId.get(g.employeeId)!;
      const match = rows.filter(
        (r) =>
          r["Employee Name"] === fullName(owner) &&
          r["Goal"] === g.title &&
          r["Due Date"] === g.dueDate &&
          r["Progress"] === `${g.percentComplete}%` &&
          r["Last Comment"] === (g.lastComment ?? ""),
      );
      expect(match.length).toBeGreaterThan(0);
    }
  });
});

describe("assessment-progress.csv", () => {
  it.each([
    ["small", small, smallFiles],
    ["demo", demo, demoFiles],
  ])("%s has one row per participant per cycle with self/manager status", (_, c, files) => {
    const { header, rows } = table(files, "assessment-progress.csv");
    expect(header).toEqual([
      "Employee Name",
      "Manager",
      "Department",
      "Review Cycle",
      "Assessed",
      "Self Status",
      "Manager Status",
      "Follow-up Notes",
    ]);
    const participants = c.assessments.filter((a) => a.employeeId !== null);
    expect(rows).toHaveLength(participants.length);
    expect(new Set(rows.map((r) => r["Review Cycle"]))).toEqual(
      new Set(c.cycles.map((cycle) => cycle.name)),
    );
    expect(new Set(rows.map((r) => r["Assessed"]))).toEqual(
      new Set(["Complete", "In Progress", "Not Started"]),
    );
    for (const row of rows) {
      const bothDone = row["Self Status"] === "Submitted" && row["Manager Status"] === "Submitted";
      const noneStarted =
        row["Self Status"] === "Not Started" && row["Manager Status"] === "Not Started";
      expect(row["Assessed"]).toBe(bothDone ? "Complete" : noneStarted ? "Not Started" : "In Progress");
    }
    const ceo = c.employees.find((e) => e.managerId === null)!;
    const ceoRows = rows.filter((r) => r["Employee Name"] === fullName(ceo));
    expect(ceoRows).toHaveLength(3);
    expect(ceoRows.every((r) => r["Manager"] === "")).toBe(true);
  });
});

describe("dirty names for the identity queue", () => {
  it.each([
    ["small", small, smallFiles],
    ["demo", demo, demoFiles],
  ])("%s reports renamed people under their name at review time", (_, c, files) => {
    const { rows } = table(files, "employee-performance.csv");
    const byId = new Map(c.employees.map((e) => [e.id, e]));
    let oldNames = 0;
    for (const r of c.identity.renames) {
      const current = fullName(byId.get(r.employeeId)!);
      const previous = `${r.previousFirstName} ${r.previousLastName}`;
      const done = c.assessments.filter(
        (a) =>
          a.employeeId === r.employeeId &&
          a.selfStatus === "Submitted" &&
          a.managerStatus === "Submitted",
      );
      for (const a of done) {
        const cycle = c.cycles[a.cycle];
        const expected = cycle.assessmentDue < r.renamedOn ? previous : current;
        const found = rows.filter(
          (row) =>
            row["Review Cycle"] === cycle.name &&
            row["Assessment Date"] === a.managerSubmittedOn &&
            row["Employee Name"] === expected,
        );
        expect(found.length, `${r.employeeId} in ${cycle.name}`).toBe(1);
        if (expected === previous) oldNames++;
      }
    }
    expect(oldNames).toBeGreaterThan(0);
  });

  it.each([
    ["small", small, smallFiles, 3],
    ["demo", demo, demoFiles, 12],
  ])("%s has misspelled names that match nobody exactly", (_, c, files, count) => {
    const { rows } = table(files, "employee-performance.csv");
    const known = new Set(c.employees.map(fullName));
    expect(c.identity.misspellings).toHaveLength(count);
    for (const m of c.identity.misspellings) {
      const employee = c.employees.find((e) => e.id === m.employeeId)!;
      expect(m.csvName).not.toBe(fullName(employee));
      expect(known.has(m.csvName)).toBe(false);
      const cycleName = c.cycles[m.cycle].name;
      expect(
        rows.some((r) => r["Review Cycle"] === cycleName && r["Employee Name"] === m.csvName),
      ).toBe(true);
    }
  });

  it.each([
    ["small", small, smallFiles],
    ["demo", demo, demoFiles],
  ])("%s has one name shared by two people in the same cycle", (_, c, files) => {
    const { rows } = table(files, "assessment-progress.csv");
    const [{ name, employeeIds }] = c.identity.duplicateNames;
    const firstCycle = c.cycles[0].name;
    const same = rows.filter((r) => r["Employee Name"] === name && r["Review Cycle"] === firstCycle);
    expect(same).toHaveLength(employeeIds.length);
  });

  it.each([
    ["small", small, smallFiles, 1],
    ["demo", demo, demoFiles, 3],
  ])("%s has report rows for people who are not in the HRIS", (_, c, files, perCycle) => {
    const known = new Set(c.employees.map(fullName));
    const reports = {
      "employee-performance": table(files, "employee-performance.csv"),
      "feedback-status": table(files, "feedback-status.csv"),
    };
    expect(c.identity.outsiders).toHaveLength(perCycle * 3 * 2);
    for (const o of c.identity.outsiders) {
      expect(known.has(o.name)).toBe(false);
      const { rows } = reports[o.report];
      const column = o.report === "feedback-status" ? "Receiving Feedback From" : "Employee Name";
      expect(
        rows.some((r) => r["Review Cycle"] === c.cycles[o.cycle].name && r[column] === o.name),
      ).toBe(true);
    }
  });
});

export type { CompanyFixture };
