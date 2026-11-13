import { describe, expect, it } from "vitest";
import {
  employeeSchema,
  employeesChangedSchema,
  employmentStatusTableSchema,
  goalsAggregateSchema,
  jobInfoTableSchema,
  listEmployeesPageSchema,
} from "./bamboo-schemas";

const listEmployee = {
  employeeId: "101",
  firstName: "Ana",
  lastName: "Ruiz",
  preferredName: null,
  jobTitleName: "CEO",
  status: "Active",
  workEmail: "ana.ruiz@meridian-andina.example",
  employeeNumber: "10003",
  reportsToId: null,
  hireDate: "2013-02-01",
  department: "Dirección General",
  division: "Corporativo",
  location: "Buenos Aires",
};

const page = (data: unknown[]) => ({
  data,
  meta: { total: data.length, page: { limit: 15, nextCursor: null, prevCursor: null } },
  _links: { self: { href: "/api/v1/employees?page[limit]=15" }, next: null, prev: null },
});

describe("list-employees page schema", () => {
  it("accepts the documented shape", () => {
    expect(listEmployeesPageSchema.safeParse(page([listEmployee])).success).toBe(true);
  });

  it("rejects numeric ids and statuses outside the enum", () => {
    expect(
      listEmployeesPageSchema.safeParse(page([{ ...listEmployee, employeeId: 101 }])).success,
    ).toBe(false);
    expect(
      listEmployeesPageSchema.safeParse(page([{ ...listEmployee, reportsToId: 7 }])).success,
    ).toBe(false);
    expect(
      listEmployeesPageSchema.safeParse(page([{ ...listEmployee, status: "active" }])).success,
    ).toBe(false);
    expect(
      listEmployeesPageSchema.safeParse(page([{ ...listEmployee, hireDate: "01/02/2013" }])).success,
    ).toBe(false);
  });
});

describe("get-employee schema", () => {
  const employee = {
    id: "101",
    firstName: "Ana",
    lastName: "Ruiz",
    workEmail: "ana.ruiz@meridian-andina.example",
    employeeNumber: "10003",
    supervisorEId: "55",
    supervisorId: "10001",
    supervisor: "Soria, Pablo",
    hireDate: "2013-02-01",
    terminationDate: null,
    department: "Dirección General",
    division: "Corporativo",
    jobTitle: "CEO",
    location: "Buenos Aires",
    status: "Active",
  };

  it("accepts a CEO without supervisor and rejects non-string ids", () => {
    expect(
      employeeSchema.safeParse({
        ...employee,
        supervisorEId: null,
        supervisorId: null,
        supervisor: null,
      }).success,
    ).toBe(true);
    expect(employeeSchema.safeParse({ ...employee, supervisorEId: 55 }).success).toBe(false);
    expect(employeeSchema.safeParse({ ...employee, id: 101 }).success).toBe(false);
  });
});

describe("tables and changes schemas", () => {
  it("validates jobInfo, employmentStatus and the changed feed", () => {
    expect(
      jobInfoTableSchema.safeParse([
        {
          id: "1001",
          employeeId: "101",
          date: "2013-02-01",
          location: "Buenos Aires",
          department: "Dirección General",
          division: "Corporativo",
          jobTitle: "CEO",
          reportsTo: null,
        },
      ]).success,
    ).toBe(true);
    expect(
      employmentStatusTableSchema.safeParse([
        {
          id: "5001",
          employeeId: "101",
          date: "2013-02-01",
          employmentStatus: "Full-Time",
          comment: null,
          terminationTypeId: null,
          terminationReasonId: null,
        },
      ]).success,
    ).toBe(true);
    expect(
      employeesChangedSchema.safeParse({
        latest: "2026-10-30T09:00:00+00:00",
        employees: {
          "101": { id: "101", action: "Updated", lastChanged: "2026-10-30T09:00:00+00:00" },
        },
      }).success,
    ).toBe(true);
    expect(
      employeesChangedSchema.safeParse({
        latest: "2026-10-30",
        employees: { "101": { id: "101", action: "Moved", lastChanged: "x" } },
      }).success,
    ).toBe(false);
  });
});

describe("goals aggregate schema", () => {
  const goal = {
    id: "5001",
    title: "Lanzar el nuevo flujo de onboarding",
    description: "Alineado con el plan del área.",
    percentComplete: 50,
    alignsWithOptionId: null,
    sharedWithEmployeeIds: [55],
    dueDate: "2025-06-30",
    completionDate: null,
    lastChangedDateTime: "2025-05-02T14:03:22Z",
    status: "in_progress",
    milestones: null,
    actions: { canEdit: true },
  };
  const aggregate = (goals: unknown[]) => ({
    canAlign: true,
    canCreateGoals: true,
    filters: [{ id: "status-all", name: "All" }],
    selectedFilter: "status-all",
    goals,
    persons: [],
    comments: [],
  });

  it("accepts in_progress/completed/closed goals with or without milestones", () => {
    const milestone = {
      id: 701,
      employeeGoalId: 5001,
      title: "Hito 1",
      currentValue: 1,
      startValue: 0,
      endValue: 1,
      completedDateTime: "2025-05-02T14:03:22Z",
      lastUpdateDateTime: "2025-05-02T14:03:22Z",
      lastUpdateUserId: 101,
    };
    expect(goalsAggregateSchema.safeParse(aggregate([goal])).success).toBe(true);
    expect(
      goalsAggregateSchema.safeParse(
        aggregate([{ ...goal, status: "completed", milestones: [milestone] }]),
      ).success,
    ).toBe(true);
  });

  it("rejects numeric goal ids and unknown statuses", () => {
    expect(goalsAggregateSchema.safeParse(aggregate([{ ...goal, id: 5001 }])).success).toBe(false);
    expect(
      goalsAggregateSchema.safeParse(aggregate([{ ...goal, status: "done" }])).success,
    ).toBe(false);
    expect(
      goalsAggregateSchema.safeParse(aggregate([{ ...goal, sharedWithEmployeeIds: ["55"] }])).success,
    ).toBe(false);
  });
});
