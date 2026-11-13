import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as fixtureSchemas from "@/fixtures/bamboo-schemas";
import {
  employeeSchema,
  employmentStatusRowSchema,
  goalsAggregateSchema,
  jobInfoRowSchema,
  listEmployeesPageSchema,
} from "./schemas";
import * as clientSchemas from "./schemas";

const page = (data: unknown[]) => ({
  data,
  meta: { total: data.length, page: { limit: 15, nextCursor: null } },
  _links: { self: "/api/v1/employees?page[limit]=15", next: null },
});

describe("list-employees page schema", () => {
  const withEmployeeId = {
    employeeId: "101",
    firstName: "Ana",
    lastName: "Ruiz",
    reportsToId: null,
    status: "Active",
  };

  it("accepts items keyed by employeeId (the real API) and normalizes to id", () => {
    const { data } = listEmployeesPageSchema.parse(page([withEmployeeId]));

    expect(data[0]).toMatchObject({ id: "101", employeeId: "101" });
    expect(data[0].firstName).toBe("Ana");
  });

  it("stringifies a numeric employeeId", () => {
    const { data } = listEmployeesPageSchema.parse(
      page([{ ...withEmployeeId, employeeId: 101 }]),
    );

    expect(data[0].id).toBe("101");
  });

  it("leaves an item that already has an id exactly as Bamboo sent it", () => {
    const item = { id: 101, firstName: "Ana", extra: { nested: true } };

    const { data } = listEmployeesPageSchema.parse(page([item]));

    expect(data[0]).toEqual(item);
  });

  it("prefers id over employeeId when an item carries both", () => {
    const { data } = listEmployeesPageSchema.parse(
      page([{ id: "7", employeeId: "8" }]),
    );

    expect(data[0].id).toBe("7");
  });

  it("rejects an item with neither id nor employeeId", () => {
    expect(
      listEmployeesPageSchema.safeParse(page([{ firstName: "Ana" }])).success,
    ).toBe(false);
  });

  it("tolerates pagination links given as { href } objects", () => {
    const body = {
      ...page([withEmployeeId]),
      _links: { self: { href: "/api/v1/employees" }, next: { href: "/n" } },
    };

    expect(listEmployeesPageSchema.safeParse(body).success).toBe(true);
  });

  it("reads a page of the generated fixtures", () => {
    const body = JSON.parse(
      readFileSync(
        path.resolve("fixtures/bamboo/small/employees/list/page-001.json"),
        "utf8",
      ),
    );

    const parsed = listEmployeesPageSchema.parse(body);

    expect(parsed.data.length).toBeGreaterThan(0);
    for (const e of parsed.data) expect(e.id).toBe(e.employeeId);
    expect(parsed.meta?.page?.nextCursor).toEqual(expect.any(String));
  });
});

describe("get-employee schema", () => {
  it("normalizes ids to strings and a missing supervisor to null", () => {
    const e = employeeSchema.parse({ id: 103, supervisorEId: 101 });
    expect(e).toMatchObject({ id: "103", supervisorEId: "101" });

    expect(employeeSchema.parse({ id: "55" }).supervisorEId).toBeNull();
    expect(
      employeeSchema.parse({ id: "55", supervisorEId: null }).supervisorEId,
    ).toBeNull();
  });

  it("keeps unknown fields and rejects a record without id", () => {
    expect(employeeSchema.parse({ id: "1", customField: "x" })).toMatchObject({
      customField: "x",
    });
    expect(employeeSchema.safeParse({ firstName: "Ana" }).success).toBe(false);
  });
});

describe("table row schemas", () => {
  it("normalize ids and keep the typed table fields", () => {
    expect(
      jobInfoRowSchema.parse({
        id: 1,
        employeeId: 101,
        date: "2019-03-01",
        reportsTo: "Ruiz, Ana",
        unknown: 1,
      }),
    ).toMatchObject({
      id: "1",
      employeeId: "101",
      reportsTo: "Ruiz, Ana",
      unknown: 1,
    });
    expect(
      employmentStatusRowSchema.parse({
        id: 5,
        employeeId: 101,
        employmentStatus: "Terminated",
        terminationTypeId: 2,
        terminationReasonId: null,
      }),
    ).toMatchObject({ id: "5", terminationTypeId: "2" });
  });
});

describe("goals aggregate schema", () => {
  it("normalizes goal ids and sharees to strings and defaults the arrays", () => {
    const parsed = goalsAggregateSchema.parse({
      goals: [{ id: 5001, sharedWithEmployeeIds: [55], milestones: null }],
    });

    expect(parsed.goals[0]).toMatchObject({
      id: "5001",
      sharedWithEmployeeIds: ["55"],
      milestones: [],
    });
    expect(parsed.persons).toEqual([]);
    expect(parsed.comments).toEqual([]);
  });
});

describe("one module for the Bamboo schemas", () => {
  it("the fixtures package re-exports the client schemas, it defines none", () => {
    for (const [name, value] of Object.entries(clientSchemas)) {
      expect(fixtureSchemas).toHaveProperty(name, value);
    }
  });
});
