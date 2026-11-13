import type {
  BambooEmployee,
  BambooGoal,
  EmployeesChanged,
  EmploymentStatusRow,
  GoalsAggregate,
  JobInfoRow,
  ListEmployee,
  ListEmployeesPage,
} from "../bamboo-schemas";
import type {
  CompanyFixture,
  FixtureEmployee,
  FixtureGoal,
} from "../company";
import { SIZE_CONFIG } from "../company/config";
import { lastFirst } from "../company/identity";
import { jsonFile, type FixtureFile } from "./files";

const byNumericId = (a: FixtureEmployee, b: FixtureEmployee): number =>
  Number(a.id) - Number(b.id);

function cursor(direction: "after" | "before", employeeId: string): string {
  return btoa(JSON.stringify({ [direction]: employeeId }));
}

function listUrl(limit: number, pageCursor?: string): string {
  const query = [`sort=employeeId`, `page[limit]=${limit}`];
  if (pageCursor) query.push(`page[cursor]=${encodeURIComponent(pageCursor)}`);
  return `/api/v1/employees?${query.join("&")}`;
}

function listEmployee(e: FixtureEmployee): ListEmployee {
  return {
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
  };
}

function getEmployee(
  e: FixtureEmployee,
  manager: FixtureEmployee | undefined,
): BambooEmployee {
  return {
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    workEmail: e.workEmail,
    employeeNumber: e.employeeNumber,
    supervisorEId: e.managerId,
    // Bamboo quirk: supervisorId is the manager's legajo, not an internal id.
    supervisorId: manager?.employeeNumber ?? null,
    supervisor: manager
      ? lastFirst({ firstName: manager.firstName, lastName: manager.lastName })
      : null,
    hireDate: e.hireDate,
    terminationDate: e.terminationDate,
    department: e.department,
    division: e.division,
    jobTitle: e.jobTitle,
    location: e.location,
    status: e.status,
  };
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Bamboo-style timestamp; the time of day is derived from the id (no clock). */
function changedStamp(date: string, employeeId: string): string {
  const n = Number(employeeId);
  return `${date}T${pad(8 + (n % 10))}:${pad((n * 7) % 60)}:00+00:00`;
}

const GOAL_FILTERS = [
  { id: "status-all", name: "All" },
  { id: "inProgress", name: "In progress" },
  { id: "completed", name: "Completed" },
  { id: "closed", name: "Closed" },
];

function goalActions(
  goal: FixtureGoal,
  ownerActive: boolean,
): Record<string, boolean> {
  const open = ownerActive && goal.status !== "closed";
  return {
    canEdit: open,
    canUpdateProgress: open && goal.status === "in_progress",
    canClose: open,
    canReopen: ownerActive && goal.status === "closed",
    canDelete: ownerActive,
    canComment: ownerActive,
  };
}

function aggregateFor(
  employee: FixtureEmployee,
  goals: FixtureGoal[],
  byId: Map<string, FixtureEmployee>,
): GoalsAggregate {
  const people = new Map<string, FixtureEmployee>([[employee.id, employee]]);
  for (const goal of goals) {
    for (const shared of goal.sharedWithEmployeeIds) {
      people.set(shared, byId.get(shared)!);
    }
  }
  return {
    canAlign: true,
    canCreateGoals: employee.status === "Active",
    filters: GOAL_FILTERS,
    selectedFilter: "status-all",
    goals: goals.map(
      (g): BambooGoal => ({
        id: g.id,
        title: g.title,
        description: g.description,
        percentComplete: g.percentComplete,
        alignsWithOptionId: g.alignsWithOptionId,
        // The one place Bamboo uses integers for employee ids.
        sharedWithEmployeeIds: g.sharedWithEmployeeIds.map(Number),
        dueDate: g.dueDate,
        completionDate: g.completionDate,
        lastChangedDateTime: g.lastChangedDateTime,
        status: g.status,
        milestones: g.milestones,
        actions: goalActions(g, employee.status === "Active"),
      }),
    ),
    persons: [...people.values()].map((p) => ({
      employeeId: Number(p.id),
      firstName: p.firstName,
      lastName: p.lastName,
      preferredName: p.preferredName,
    })),
    comments: goals
      .filter((g) => g.commentCount > 0)
      .map((g) => ({ goalId: g.id, commentCount: g.commentCount })),
  };
}

/**
 * Files that mirror the Bamboo public API responses we ingest, relative to
 * `fixtures/bamboo/<size>/`.
 */
export function serializeBambooApi(company: CompanyFixture): FixtureFile[] {
  const files: FixtureFile[] = [];
  const employees = [...company.employees].sort(byNumericId);
  const byId = new Map(employees.map((e) => [e.id, e]));
  const limit = SIZE_CONFIG[company.size].pageLimit;

  // GET /api/v1/employees?sort=employeeId&page[limit]=N (cursor pagination)
  const pageCount = Math.ceil(employees.length / limit);
  const chunks = Array.from({ length: pageCount }, (_, i) =>
    employees.slice(i * limit, (i + 1) * limit),
  );
  chunks.forEach((chunk, i) => {
    const first = chunk[0].id;
    const last = chunk[chunk.length - 1].id;
    const nextCursor = i < pageCount - 1 ? cursor("after", last) : null;
    const prevCursor = i > 0 ? cursor("before", first) : null;
    const page: ListEmployeesPage = {
      data: chunk.map(listEmployee),
      meta: { total: employees.length, page: { limit, nextCursor, prevCursor } },
      _links: {
        self: {
          href: listUrl(limit, i > 0 ? cursor("after", chunks[i - 1].at(-1)!.id) : undefined),
        },
        next: nextCursor ? { href: listUrl(limit, nextCursor) } : null,
        prev: prevCursor ? { href: listUrl(limit, prevCursor) } : null,
      },
    };
    files.push(jsonFile(`employees/list/page-${String(i + 1).padStart(3, "0")}.json`, page));
  });

  // GET /api/v1/employees/{id}
  for (const e of employees) {
    files.push(
      jsonFile(
        `employees/get/${e.id}.json`,
        getEmployee(e, e.managerId === null ? undefined : byId.get(e.managerId)),
      ),
    );
  }

  // GET /api/v1/employees/all/tables/jobInfo (reportsTo is a NAME, not an id)
  const jobRows: JobInfoRow[] = company.jobHistory.map((row) => {
    const manager = row.managerId === null ? undefined : byId.get(row.managerId);
    return {
      id: row.id,
      employeeId: row.employeeId,
      date: row.date,
      location: row.location,
      department: row.department,
      division: row.division,
      jobTitle: row.jobTitle,
      reportsTo: manager
        ? lastFirst({ firstName: manager.firstName, lastName: manager.lastName })
        : null,
    };
  });
  files.push(jsonFile("employees/tables/jobInfo/all.json", jobRows));

  // GET /api/v1/employees/all/tables/employmentStatus
  const statusRows: EmploymentStatusRow[] = company.employmentHistory.map(
    (row) => ({ ...row }),
  );
  files.push(
    jsonFile("employees/tables/employmentStatus/all.json", statusRows),
  );

  // GET /api/v1/employees/changed?type=all (a full load: since the beginning)
  const renamedOn = new Map(
    company.identity.renames.map((r) => [r.employeeId, r.renamedOn]),
  );
  const changed: EmployeesChanged["employees"] = {};
  for (const e of employees) {
    const dates = [
      e.hireDate,
      e.terminationDate,
      renamedOn.get(e.id) ?? null,
      ...company.jobHistory.filter((r) => r.employeeId === e.id).map((r) => r.date),
    ].filter((d): d is string => d !== null);
    const lastDate = dates.reduce((a, b) => (a > b ? a : b));
    changed[e.id] = {
      id: e.id,
      action: lastDate === e.hireDate ? "Inserted" : "Updated",
      lastChanged: changedStamp(lastDate, e.id),
    };
  }
  const latest = Object.values(changed)
    .map((entry) => entry.lastChanged)
    .reduce((a, b) => (a > b ? a : b));
  files.push(jsonFile("employees/changed.json", { latest, employees: changed }));

  // GET /api/v1_2/performance/employees/{id}/goals/aggregate?filter=status-all
  for (const e of employees) {
    const goals = company.goals.filter((g) => g.employeeId === e.id);
    files.push(jsonFile(`performance/goals/${e.id}.json`, aggregateFor(e, goals, byId)));
  }

  return files;
}
