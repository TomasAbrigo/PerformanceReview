import { describe, expect, it } from "vitest";
import {
  ORG_ATTRIBUTE_EPOCH,
  stagedOrgAttributeSchema,
  upsertOrgAttributes,
} from "./import";

const staged = (fields: Record<string, unknown>, dateFormat?: "dmy" | "mdy") =>
  stagedOrgAttributeSchema.safeParse({ fields, dateFormat });

describe("stagedOrgAttributeSchema", () => {
  it("reads an EEID with its values and dates, trimmed, empty cells as null", () => {
    const result = staged({
      employee_bamboo_id: " 11 ",
      account: "Cuenta A ",
      project: "",
      dm: "Marta Quiroga",
      santex_lead: null,
      valid_from: "2024-01-01",
      valid_to: "2024-12-31",
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      fields: {
        employee_bamboo_id: "11",
        employee_name: null,
        account: "Cuenta A",
        project: null,
        dm: "Marta Quiroga",
        santex_lead: null,
      },
      validFrom: "2024-01-01",
      validTo: "2024-12-31",
    });
  });

  it("holds since ever (and open) without Desde and Hasta", () => {
    const result = staged({ employee_bamboo_id: 11, account: "A" });

    expect(result.data).toMatchObject({
      validFrom: ORG_ATTRIBUTE_EPOCH,
      validTo: null,
      fields: { employee_bamboo_id: "11" },
    });
  });

  it("reads day/month dates the way the profile says", () => {
    expect(
      staged(
        { employee_bamboo_id: "1", account: "A", valid_from: "03/04/2025" },
        "dmy",
      ).data,
    ).toMatchObject({ validFrom: "2025-04-03" });
    expect(
      staged(
        { employee_bamboo_id: "1", account: "A", valid_from: "03/04/2025" },
        "mdy",
      ).data,
    ).toMatchObject({ validFrom: "2025-03-04" });
  });

  it.each([
    ["no EEID", { account: "A" }, /EEID is empty/],
    [
      "a date that is none",
      { employee_bamboo_id: "1", account: "A", valid_from: "pronto" },
      /Desde "pronto" is not a date/,
    ],
    [
      "an ambiguous date without a format",
      { employee_bamboo_id: "1", account: "A", valid_from: "03/04/2025" },
      /not a date/,
    ],
    [
      "Hasta before Desde",
      {
        employee_bamboo_id: "1",
        account: "A",
        valid_from: "2025-02-01",
        valid_to: "2025-01-01",
      },
      /before Desde/,
    ],
    [
      "nothing to say",
      { employee_bamboo_id: "1", account: " ", dm: null },
      /no Cuenta, Proyecto, DM or Santex Lead/,
    ],
  ])("rejects a row with %s", (_why, fields, message) => {
    const result = staged(fields);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message).join(" ")).toMatch(
      message,
    );
  });
});

describe("stagedOrgAttributeSchema: a column the file lacks is not an empty cell", () => {
  it("leaves the kinds without a column undefined and the emptied cells null", () => {
    const result = stagedOrgAttributeSchema.safeParse({
      fields: { employee_bamboo_id: "11", dm: "Marta Quiroga", project: " " },
    });

    expect(result.success).toBe(true);
    expect(result.data?.fields.dm).toBe("Marta Quiroga");
    // The file has the Proyecto column and this cell is empty: drop it.
    expect(result.data?.fields.project).toBeNull();
    // No Cuenta or Santex Lead column at all: say nothing about them.
    expect(result.data?.fields.account).toBeUndefined();
    expect(result.data?.fields.santex_lead).toBeUndefined();
  });

  it("a row of a file with no value in the columns it has is still rejected", () => {
    const result = stagedOrgAttributeSchema.safeParse({
      fields: { employee_bamboo_id: "11", dm: "" },
    });

    expect(result.success).toBe(false);
  });
});

describe("upsertOrgAttributes: what a row costs", () => {
  /** A transaction that counts its reads and writes; every lookup the row needs is already in the cache. */
  function setup() {
    const calls = { select: 0, insert: 0, update: 0 };
    const tx = {
      select: () => {
        calls.select++;
        return { from: () => ({ where: async () => [] }) };
      },
      insert: () => {
        calls.insert++;
        return { values: async () => undefined };
      },
      update: () => {
        calls.update++;
        return { set: () => ({ where: async () => undefined }) };
      },
    };
    const lookups = { name: 0 };
    const names = new Map<string, string[]>([
      ["marta quiroga", ["person-marta"]],
    ]);
    const countingNames = {
      get: (key: string) => {
        lookups.name++;
        return names.get(key);
      },
    };
    const cache = new Map<string, unknown>([
      [
        "idIndex",
        {
          bamboo_id: new Map([
            ["11", "person-ana"],
            ["12", "person-bruno"],
          ]),
          employee_number: new Map(),
          work_email: new Map(),
        },
      ],
      ["nameIndex", countingNames],
      ["orgAttributeLinks", new Map()],
      ["openIssues:org_attribute", new Set()],
    ]);
    const run = (eeid: string, fields: Record<string, string>) => {
      const staged = stagedOrgAttributeSchema.parse({
        fields: { employee_bamboo_id: eeid, ...fields },
      });
      return upsertOrgAttributes(tx as never, staged, {
        source: "lake",
        hash: "h",
        runId: "run",
        sourceId: JSON.stringify([eeid, ""]),
        payload: {},
        cache,
      });
    };
    return { calls, lookups, run };
  }

  it("reads the person's existing attributes once, whatever the kinds of the row", async () => {
    const { calls, run } = setup();

    await run("11", {
      account: "Cuenta A",
      project: "Proyecto A1",
      dm: "Marta Quiroga",
      santex_lead: "Marta Quiroga",
    });

    expect(calls.select).toBe(1);
    expect(calls.insert).toBe(4);
  });

  it("resolves a DM's name to a person once for the whole run", async () => {
    const { lookups, run } = setup();

    for (const eeid of ["11", "12", "11", "12"]) {
      await run(eeid, { dm: "Marta Quiroga", santex_lead: "Marta Quiroga" });
    }

    // Eight cells name her; the name index is asked once.
    expect(lookups.name).toBe(1);
  });
});
