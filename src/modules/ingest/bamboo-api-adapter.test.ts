import { describe, expect, it } from "vitest";
import type {
  BambooClient,
  ListEmployeesOptions,
} from "@/modules/bamboo-client";
import { BambooApiAdapter, EMPLOYEE_FIELDS } from "./bamboo-api-adapter";

describe("BambooApiAdapter", () => {
  it("extracts employees keyed by their internal id", async () => {
    let seen: ListEmployeesOptions | undefined;
    const client: BambooClient = {
      async *listEmployees(options) {
        seen = options;
        yield { id: "7", employeeNumber: "A-1", supervisorEId: null };
      },
      getEmployee: () => Promise.reject(new Error("unused")),
      getChangedEmployees: () => Promise.reject(new Error("unused")),
    };
    const adapter = new BambooApiAdapter(client);

    const out = [];
    for await (const r of adapter.extract({}, "employee")) out.push(r);

    expect(adapter.source).toBe("bamboo_api");
    expect(seen?.fields).toEqual(EMPLOYEE_FIELDS);
    expect(out).toEqual([
      {
        sourceId: "7",
        payload: { id: "7", employeeNumber: "A-1", supervisorEId: null },
        extractedAt: expect.any(Date),
      },
    ]);
  });
});
