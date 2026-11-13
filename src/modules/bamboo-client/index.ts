import { createHttp, type BambooConfig } from "./http";
import {
  changedEmployeesSchema,
  employeeSchema,
  listEmployeesPageSchema,
  type BambooEmployee,
  type ChangedEmployees,
  type RawBambooEmployee,
} from "./schemas";

export { BambooError, type BambooConfig } from "./http";
export type {
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

export type BambooClient = {
  listEmployees(options: ListEmployeesOptions): AsyncIterable<BambooEmployee>;
  /** Same records unparsed: what ingest stores in raw_record and hashes. */
  listEmployeesRaw(
    options: ListEmployeesOptions,
  ): AsyncIterable<RawBambooEmployee>;
  getEmployee(id: string, fields: string[]): Promise<BambooEmployee>;
  getChangedEmployees(since: Date | string): Promise<ChangedEmployees>;
};

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
      const iso = typeof since === "string" ? since : since.toISOString();
      return changedEmployeesSchema.parse(
        await get("/api/v1/employees/changed", { since: iso, type: "all" }),
      );
    },
  };
}
