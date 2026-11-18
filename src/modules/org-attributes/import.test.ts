import { describe, expect, it } from "vitest";
import { ORG_ATTRIBUTE_EPOCH, stagedOrgAttributeSchema } from "./import";

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
