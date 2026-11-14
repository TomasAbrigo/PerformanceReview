import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  changedEmployeesSchema,
  employeeSchema,
  employmentStatusRowSchema,
  goalsAggregateSchema,
  jobInfoRowSchema,
  listEmployeesPageSchema,
} from "../bamboo-schemas";
import { generateCompany } from "../company";
import { serializeBambooApi } from "./bamboo-api";
import type { FixtureFile } from "./files";

const small = generateCompany({ size: "small", seed: 1001 });
const demo = generateCompany({ size: "demo", seed: 2002 });
const smallFiles = serializeBambooApi(small);
const demoFiles = serializeBambooApi(demo);

function json(files: FixtureFile[], path: string): unknown {
  const file = files.find((f) => f.path === path);
  if (!file) throw new Error(`missing fixture file ${path}`);
  return JSON.parse(file.content);
}

const jobInfoTableSchema = z.array(jobInfoRowSchema);
const employmentStatusTableSchema = z.array(employmentStatusRowSchema);

function listPages(files: FixtureFile[]) {
  return files
    .filter((f) => f.path.startsWith("employees/list/page-"))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => listEmployeesPageSchema.parse(JSON.parse(f.content)));
}

describe("list-employees pages", () => {
  it.each([
    ["small", small, smallFiles, 15],
    ["demo", demo, demoFiles, 100],
  ])(
    "%s paginates every employee by cursor in id order",
    (_, c, files, limit) => {
      const pages = listPages(files);
      expect(pages.length).toBe(Math.ceil(c.employees.length / limit));
      const ids = pages.flatMap((p) => p.data.map((e) => e.id));
      expect(ids).toEqual(
        c.employees.map((e) => e.id).sort((a, b) => Number(a) - Number(b)),
      );
      pages.forEach((page, i) => {
        expect(page.meta?.total).toBe(c.employees.length);
        expect(page.meta?.page?.limit).toBe(limit);
        const isLast = i === pages.length - 1;
        expect(page.meta?.page?.nextCursor === null).toBe(isLast);
        expect(page.meta?.page?.prevCursor === null).toBe(i === 0);
        expect(page._links?.next == null).toBe(isLast);
        expect(page._links?.prev == null).toBe(i === 0);
      });
      const cursors = pages.flatMap((p) =>
        [p.meta?.page?.nextCursor].filter(Boolean),
      );
      expect(new Set(cursors).size).toBe(pages.length - 1);
    },
  );

  it.each([
    ["small", small, smallFiles],
    ["demo", demo, demoFiles],
  ])(
    "%s lists current employee data with the manager as an internal id",
    (_, c, files) => {
      const listed = new Map(
        listPages(files).flatMap((p) =>
          p.data.map((e) => [String(e.id), e] as const),
        ),
      );
      for (const e of c.employees) {
        expect(listed.get(e.id)).toMatchObject({
          employeeId: e.id,
          firstName: e.firstName,
          lastName: e.lastName,
          preferredName: e.preferredName,
          jobTitleName: e.jobTitle,
          status: e.status,
          workEmail: e.workEmail,
          employeeNumber: e.employeeNumber,
          reportsToId: e.managerId,
          hireDate: e.hireDate,
          department: e.department,
          division: e.division,
          location: e.location,
        });
      }
    },
  );
});

describe("get-employee files", () => {
  it.each([
    ["small", small, smallFiles],
    ["demo", demo, demoFiles],
  ])(
    "%s has one file per employee; supervisor fields follow the Bamboo quirks",
    (_, c, files) => {
      const byId = new Map(c.employees.map((e) => [e.id, e]));
      for (const e of c.employees) {
        const got = employeeSchema.parse(
          json(files, `employees/get/${e.id}.json`),
        );
        expect(got).toMatchObject({
          id: e.id,
          firstName: e.firstName,
          lastName: e.lastName,
          workEmail: e.workEmail,
          employeeNumber: e.employeeNumber,
          hireDate: e.hireDate,
          terminationDate: e.terminationDate,
          department: e.department,
          division: e.division,
          jobTitle: e.jobTitle,
          location: e.location,
          status: e.status,
          supervisorEId: e.managerId,
        });
        if (e.managerId === null) {
          expect(got.supervisorId).toBeNull();
          expect(got.supervisor).toBeNull();
        } else {
          const manager = byId.get(e.managerId)!;
          expect(got.supervisorId).toBe(manager.employeeNumber);
          expect(got.supervisor).toBe(
            `${manager.lastName}, ${manager.firstName}`,
          );
        }
      }
      expect(
        files.filter((f) => f.path.startsWith("employees/get/")),
      ).toHaveLength(c.employees.length);
    },
  );
});

describe("jobInfo and employmentStatus tables", () => {
  it.each([
    ["small", small, smallFiles],
    ["demo", demo, demoFiles],
  ])(
    "%s jobInfo/all carries the history with reportsTo as a display name",
    (_, c, files) => {
      const rows = jobInfoTableSchema.parse(
        json(files, "employees/tables/jobInfo/all.json"),
      );
      expect(rows).toHaveLength(c.jobHistory.length);
      const byId = new Map(c.employees.map((e) => [e.id, e]));
      const fixtureRows = new Map(c.jobHistory.map((r) => [r.id, r]));
      for (const row of rows) {
        const source = fixtureRows.get(row.id)!;
        expect(row).toMatchObject({
          employeeId: source.employeeId,
          date: source.date,
          location: source.location,
          department: source.department,
          division: source.division,
          jobTitle: source.jobTitle,
        });
        if (source.managerId === null) {
          expect(row.reportsTo).toBeNull();
        } else {
          const manager = byId.get(source.managerId)!;
          expect(row.reportsTo).toBe(
            `${manager.lastName}, ${manager.firstName}`,
          );
          expect(row.reportsTo).not.toBe(source.managerId);
        }
      }
    },
  );

  it.each([
    ["small", small, smallFiles],
    ["demo", demo, demoFiles],
  ])(
    "%s employmentStatus/all carries hires and terminations",
    (_, c, files) => {
      const rows = employmentStatusTableSchema.parse(
        json(files, "employees/tables/employmentStatus/all.json"),
      );
      expect(rows).toHaveLength(c.employmentHistory.length);
      expect(
        rows.filter((r) => r.employmentStatus === "Terminated").length,
      ).toBe(c.employees.filter((e) => e.terminationDate !== null).length);
      expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    },
  );
});

describe("employees/changed", () => {
  it.each([
    ["small", small, smallFiles],
    ["demo", demo, demoFiles],
  ])("%s lists every employee with its last change", (_, c, files) => {
    const feed = changedEmployeesSchema.parse(
      json(files, "employees/changed.json"),
    );
    expect(Object.keys(feed.employees).sort()).toEqual(
      c.employees.map((e) => e.id).sort(),
    );
    const stamps = Object.values(feed.employees).map((e) => e.lastChanged);
    expect(feed.latest).toBe([...stamps].sort().at(-1));
    for (const e of c.employees) {
      const entry = feed.employees[e.id];
      expect(entry.id).toBe(e.id);
      expect(entry.lastChanged.slice(0, 10) >= e.hireDate).toBe(true);
      expect(entry.lastChanged.slice(0, 10) <= c.asOf).toBe(true);
      if (e.terminationDate !== null) {
        expect(entry.lastChanged.slice(0, 10) >= e.terminationDate).toBe(true);
      }
    }
    const actions = new Set(Object.values(feed.employees).map((e) => e.action));
    expect(actions).toEqual(new Set(["Inserted", "Updated"]));
  });
});

describe("goals aggregate v1_2", () => {
  it.each([
    ["small", small, smallFiles],
    ["demo", demo, demoFiles],
  ])(
    "%s has one aggregate per employee with string goal ids and integer shares",
    (_, c, files) => {
      let goalCount = 0;
      for (const e of c.employees) {
        const raw = json(files, `performance/goals/${e.id}.json`) as {
          goals: { sharedWithEmployeeIds: unknown[]; milestones: unknown }[];
        };
        const aggregate = goalsAggregateSchema.parse(raw);
        const mine = c.goals.filter((g) => g.employeeId === e.id);
        expect(aggregate.goals.map((g) => g.id)).toEqual(mine.map((g) => g.id));
        expect(aggregate.persons.map((p) => p.employeeId)).toContain(e.id);
        expect(aggregate.comments).toEqual(
          mine
            .filter((g) => g.commentCount > 0)
            .map((g) => ({ goalId: g.id, commentCount: g.commentCount })),
        );
        for (const [i, goal] of aggregate.goals.entries()) {
          expect(goal.sharedWithEmployeeIds).toEqual(
            mine[i].sharedWithEmployeeIds,
          );
          // On the wire Bamboo uses integers for these employee ids.
          expect(raw.goals[i].sharedWithEmployeeIds).toEqual(
            mine[i].sharedWithEmployeeIds.map(Number),
          );
          expect(raw.goals[i].milestones === null).toBe(
            mine[i].milestones === null,
          );
        }
        goalCount += aggregate.goals.length;
      }
      expect(goalCount).toBe(c.goals.length);
    },
  );
});

describe("cross-file consistency", () => {
  it.each([
    ["small", small, smallFiles],
    ["demo", demo, demoFiles],
  ])("%s uses the same employee ids in every file", (_, c, files) => {
    const ids = new Set(c.employees.map((e) => e.id));
    const listed = listPages(files).flatMap((p) => p.data.map((e) => e.id));
    const jobIds = jobInfoTableSchema
      .parse(json(files, "employees/tables/jobInfo/all.json"))
      .map((r) => r.employeeId);
    const statusIds = employmentStatusTableSchema
      .parse(json(files, "employees/tables/employmentStatus/all.json"))
      .map((r) => r.employeeId);
    expect(new Set(listed)).toEqual(ids);
    expect(new Set(jobIds)).toEqual(ids);
    expect(new Set(statusIds)).toEqual(ids);
    for (const page of listPages(files)) {
      for (const e of page.data) {
        if (e.reportsToId != null) {
          expect(ids.has(String(e.reportsToId))).toBe(true);
        }
      }
    }
  });

  it("is deterministic: same seed, byte-identical files", () => {
    expect(
      serializeBambooApi(generateCompany({ size: "small", seed: 1001 })),
    ).toEqual(smallFiles);
    expect(
      serializeBambooApi(generateCompany({ size: "small", seed: 1002 })),
    ).not.toEqual(smallFiles);
  });
});

/** Where Bamboo really sends integers (everything else is a numeric string). */
const INTEGER_PATH =
  /\.(persons\[\d+\]\.employeeId|alignsWithOptionId|milestones\[\d+\]\.(id|employeeGoalId|lastUpdateUserId))$/;
const ID_KEY = /^id$|Id$/;
/** The schemas do not check values; the generator must still only emit valid ones. */
const ENUM_PATHS: [RegExp, RegExp][] = [
  [/^employees\/(list|get)\/.*\.status$/, /^(Active|Inactive)$/],
  [
    /^performance\/goals\/.*\.goals\[\d+\]\.status$/,
    /^(in_progress|completed|closed)$/,
  ],
  [
    /^employees\/changed\.json\.employees\.\d+\.action$/,
    /^(Inserted|Updated|Deleted)$/,
  ],
];

/** Paths of the values that break the wire conventions of the fixtures. */
function wireProblems(value: unknown, at: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => wireProblems(v, `${at}[${i}]`));
  }
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) => {
    const where = `${at}.${key}`;
    if (key === "filters") return []; // ids like "status-all"
    if (key === "sharedWithEmployeeIds") {
      return (v as unknown[]).every(Number.isInteger) ? [] : [where];
    }
    const enumRule = ENUM_PATHS.find(([path]) => path.test(where));
    if (enumRule)
      return typeof v === "string" && enumRule[1].test(v) ? [] : [where];
    if (/\.percentComplete$/.test(where)) {
      return typeof v === "number" && v >= 0 && v <= 100 ? [] : [where];
    }
    if (v === null) return [];
    if (INTEGER_PATH.test(where)) return Number.isInteger(v) ? [] : [where];
    const isString = typeof v === "string";
    if (ID_KEY.test(key)) return isString && /^\d+$/.test(v) ? [] : [where];
    if (/DateTime$/.test(key)) {
      return isString && /^\d{4}-\d{2}-\d{2}T/.test(v) ? [] : [where];
    }
    if (/^date$|Date$/.test(key)) {
      return isString && /^\d{4}-\d{2}-\d{2}$/.test(v) ? [] : [where];
    }
    return wireProblems(v, where);
  });
}

describe("wire conventions", () => {
  it("notices a value outside the conventions", () => {
    expect(
      wireProblems(
        {
          data: [
            { employeeId: "1", status: "Retired", hireDate: "01/02/2013" },
          ],
        },
        "employees/list/page-001.json",
      ),
    ).toEqual([
      "employees/list/page-001.json.data[0].status",
      "employees/list/page-001.json.data[0].hireDate",
    ]);
    expect(
      wireProblems(
        { goals: [{ id: 5, status: "done", percentComplete: 101 }] },
        "performance/goals/1.json",
      ),
    ).toEqual([
      "performance/goals/1.json.goals[0].id",
      "performance/goals/1.json.goals[0].status",
      "performance/goals/1.json.goals[0].percentComplete",
    ]);
    expect(
      wireProblems(
        { employees: { "11": { id: "11", action: "Moved" } } },
        "employees/changed.json",
      ),
    ).toEqual(["employees/changed.json.employees.11.action"]);
  });

  it.each([
    ["small", smallFiles],
    ["demo", demoFiles],
  ])(
    "%s: ids are numeric strings, dates are ISO, nothing is 0000-00-00",
    (_, files) => {
      const jsonFiles = files.filter((f) => f.path.endsWith(".json"));
      expect(jsonFiles.length).toBeGreaterThan(0);
      expect(
        jsonFiles.flatMap((f) => wireProblems(JSON.parse(f.content), f.path)),
      ).toEqual([]);
      expect(files.some((f) => f.content.includes("0000-00-00"))).toBe(false);
    },
  );
});
