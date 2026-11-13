import type { BambooClient } from "@/modules/bamboo-client";
import { groupTables } from "./fixture-adapter";
import type {
  Entity,
  ExtractContext,
  ExtractedRecord,
  SourceAdapter,
} from "./types";

export const EMPLOYEE_FIELDS = [
  "employeeNumber",
  "firstName",
  "lastName",
  "displayName",
  "workEmail",
  "status",
  "hireDate",
  "terminationDate",
  "supervisorEId",
  "supervisorId",
];

/** Live Bamboo API source (list-employees, all statuses). */
export class BambooApiAdapter implements SourceAdapter {
  readonly source = "bamboo_api" as const;
  readonly name = "bamboo";
  readonly entities = ["employee", "job_history"] as const;

  constructor(private readonly client: BambooClient) {}

  async *extract(
    ctx: ExtractContext,
    entity: Entity,
  ): AsyncIterable<ExtractedRecord> {
    if (entity === "job_history") {
      const [jobInfo, status] = ctx.since
        ? await this.changedTables(ctx.since)
        : [
            await this.client.getEmployeeTable("all", "jobInfo"),
            await this.client.getEmployeeTable("all", "employmentStatus"),
          ];
      const extractedAt = new Date();
      for (const payload of groupTables(jobInfo, status)) {
        yield { sourceId: payload.employeeId, payload, extractedAt };
      }
      return;
    }
    if (entity !== "employee") throw new Error(`Unsupported entity ${entity}`);
    // Raw payloads (not the zod-normalized ones): raw_record stays raw and the
    // hash matches any other adapter fed the same Bamboo JSON.
    for await (const payload of this.client.listEmployeesRaw({
      fields: EMPLOYEE_FIELDS,
    })) {
      yield {
        sourceId: String(payload.id),
        payload,
        extractedAt: new Date(),
      };
    }
  }

  /**
   * Both tables, complete, for every employee with a change in either since
   * `since` (the history is rebuilt per employee, so partial rows would not do).
   */
  private async changedTables(since: string) {
    const tables = ["jobInfo", "employmentStatus"] as const;
    const changed = await Promise.all(
      tables.map((t) => this.client.getChangedEmployeeTables(t, since)),
    );
    const ids = new Set(changed.flatMap((c) => Object.keys(c.employees)));
    const rows = tables.map(() => [] as unknown[]);
    for (const id of ids) {
      for (const [i, table] of tables.entries()) {
        const fromFeed = changed[i].employees[id]?.rows;
        const tableRows =
          fromFeed ?? (await this.client.getEmployeeTable(id, table));
        rows[i].push(...tableRows);
      }
    }
    return rows as [unknown[], unknown[]];
  }
}
