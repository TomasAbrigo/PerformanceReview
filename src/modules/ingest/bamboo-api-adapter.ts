import type { BambooClient } from "@/modules/bamboo-client";
import { extractGoals } from "./goals-extract";
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
  readonly entities = ["employee", "goal"] as const;

  constructor(private readonly client: BambooClient) {}

  async *extract(
    ctx: ExtractContext,
    entity: Entity,
  ): AsyncIterable<ExtractedRecord> {
    if (entity === "goal") {
      yield* extractGoals(this.client, ctx.employeeIds ?? []);
      return;
    }
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
}
