import { createGoalsEndpoints, type GoalsEndpoints } from "./goals";
import { createHttp, type BambooConfig } from "./http";
import {
  changedEmployeesSchema,
  changedTablesSchema,
  employeeSchema,
  listEmployeesPageSchema,
  tableRowsSchema,
  type BambooEmployee,
  type BambooTableRow,
  type ChangedEmployees,
  type ChangedTables,
  type RawBambooEmployee,
} from "./schemas";

export { BambooError, type BambooConfig } from "./http";
export { parseGoalComments, parseGoalsAggregate } from "./goals";
export type {
  BambooGoal,
  BambooGoalComment,
  BambooGoalMilestone,
  BambooGoalsAggregate,
} from "./goals";
export type {
  BambooTableRow,
  ChangedTables,
  BambooEmployee,
  ChangedEmployees,
  RawBambooEmployee,
} from "./schemas";

export type ListEmployeesOptions = {
  fields: string[];
  /** e.g. { status: "active" } → filter[status]=active */
  filter?: Record<string, string>;
  /** Page size (Bamboo max 2500). */
  limit?: number;
};

export type BambooClient = GoalsEndpoints & {
  listEmployees(options: ListEmployeesOptions): AsyncIterable<BambooEmployee>;
  /** Same records unparsed: what ingest stores in raw_record and hashes. */
  listEmployeesRaw(
    options: ListEmployeesOptions,
  ): AsyncIterable<RawBambooEmployee>;
  getEmployee(id: string, fields: string[]): Promise<BambooEmployee>;
  getChangedEmployees(since: Date | string): Promise<ChangedEmployees>;
  /** Rows of an employee table (e.g. jobInfo) for one employee or "all". */
  getEmployeeTable(id: string, table: string): Promise<BambooTableRow[]>;
  /** All rows of `table` for employees whose rows changed since `since`. */
  getChangedEmployeeTables(
    table: string,
    since: Date | string,
  ): Promise<ChangedTables>;
};

const isoOf = (since: Date | string) =>
  typeof since === "string" ? since : since.toISOString();

export function createBambooClient(config: BambooConfig): BambooClient {
  const get = createHttp(config);

  async function* listEmployeesRaw({
    fields,
    filter = {},
    limit = 2500,
  }: ListEmployeesOptions): AsyncIterable<RawBambooEmployee> {
    const base: Record<string, string> = {
      fields: fields.join(","),
      "page[limit]": String(limit),
    };
    for (const [k, v] of Object.entries(filter)) base[`filter[${k}]`] = v;

    let after: string | undefined;
    do {
      const page = listEmployeesPageSchema.parse(
        await get("/api/v1/employees", { ...base, "page[after]": after }),
      );
      yield* page.data;
      after = page.meta?.page?.nextCursor ?? undefined;
    } while (after);
  }

  return {
    ...createGoalsEndpoints(get),

    listEmployeesRaw,

    async *listEmployees(options) {
      for await (const raw of listEmployeesRaw(options)) {
        yield employeeSchema.parse(raw);
      }
    },

    async getEmployee(id, fields) {
      return employeeSchema.parse(
        await get(`/api/v1/employees/${encodeURIComponent(id)}`, {
          fields: fields.join(","),
        }),
      );
    },

    async getChangedEmployees(since) {
      return changedEmployeesSchema.parse(
        await get("/api/v1/employees/changed", {
          since: isoOf(since),
          type: "all",
        }),
      );
    },

    async getEmployeeTable(id, table) {
      return tableRowsSchema.parse(
        await get(
          `/api/v1/employees/${encodeURIComponent(id)}/tables/${encodeURIComponent(table)}`,
        ),
      );
    },

    async getChangedEmployeeTables(table, since) {
      return changedTablesSchema.parse(
        await get(
          `/api/v1/employees/changed/tables/${encodeURIComponent(table)}`,
          { since: isoOf(since) },
        ),
      );
    },
  };
}
