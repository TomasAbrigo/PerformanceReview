import { describe, expect, it } from "vitest";
import { stagedEngagementSchema } from "./import";

const staged = (fields: Record<string, unknown>) =>
  stagedEngagementSchema.safeParse({ fields });

describe("stagedEngagementSchema", () => {
  it("reads an EEID, a month, a score and a segment, trimmed", () => {
    const result = staged({
      employee_bamboo_id: " 11 ",
      employee_name: "Ana Prieto ",
      month: "2026-03",
      score: "0,73",
      segment: " Medio",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      employeeBambooId: "11",
      employeeName: "Ana Prieto",
      month: "2026-03-01",
      score: 0.73,
      segment: "medio",
    });
  });

  it("takes a month written MM/YYYY and a numeric EEID and score", () => {
    expect(
      staged({ employee_bamboo_id: 7, month: "03/2026", score: 0.5 }).data,
    ).toMatchObject({
      employeeBambooId: "7",
      month: "2026-03-01",
      score: 0.5,
      segment: null,
    });
  });

  it("leaves the segment open when the file has none (it is derived on import)", () => {
    expect(
      staged({ employee_bamboo_id: "1", month: "2026-03", score: "0.9" }).data,
    ).toMatchObject({ score: 0.9, segment: null });
  });

  it("a falta row has no score, whatever the cell says", () => {
    expect(
      staged({
        employee_bamboo_id: "1",
        month: "2026-03",
        score: "0",
        segment: "Falta",
      }).data,
    ).toMatchObject({ score: null, segment: "falta" });
    expect(
      staged({ employee_bamboo_id: "1", month: "2026-03", segment: "Falta" })
        .data,
    ).toMatchObject({ score: null, segment: "falta" });
  });

  it("keeps a segment given without a score", () => {
    expect(
      staged({ employee_bamboo_id: "1", month: "2026-03", segment: "Alto" })
        .data,
    ).toMatchObject({ score: null, segment: "alto" });
  });

  it.each([
    ["no EEID", { month: "2026-03", score: "0.5" }, /EEID/],
    [
      "an empty EEID",
      { employee_bamboo_id: " ", month: "2026-03", score: "0.5" },
      /EEID/,
    ],
    ["no month", { employee_bamboo_id: "1", score: "0.5" }, /Mes/],
    [
      "a month that is not one",
      { employee_bamboo_id: "1", month: "marzo", score: "0.5" },
      /Mes "marzo"/,
    ],
    [
      "a score above 1",
      { employee_bamboo_id: "1", month: "2026-03", score: "1.5" },
      /Score "1.5"/,
    ],
    [
      "a score that is not a number",
      { employee_bamboo_id: "1", month: "2026-03", score: "alto" },
      /Score "alto"/,
    ],
    [
      "an unknown segment",
      { employee_bamboo_id: "1", month: "2026-03", segment: "genial" },
      /Segmento "genial"/,
    ],
    [
      "neither score nor segment",
      { employee_bamboo_id: "1", month: "2026-03" },
      /neither/,
    ],
  ])("rejects %s", (_name, fields, message) => {
    const result = staged(fields);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message).join("; ")).toMatch(
      message,
    );
  });
});
