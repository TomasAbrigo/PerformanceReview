import { describe, expect, it } from "vitest";
import {
  stagedAnyAssessmentSchema,
  stagedAnyProgressSchema,
} from "./report-formats";

const messages = (r: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => (r.success ? [] : r.error!.issues.map((i) => i.message));

describe("report schemas dispatch on format (#83)", () => {
  it("keeps the raw report's own reject message", () => {
    const r = stagedAnyAssessmentSchema.safeParse({
      format: "assessments_report",
      fields: { employee_bamboo_id: "13", period_start: "someday" },
      raw: {},
    });
    expect(messages(r)).toEqual([
      'Review Period Start "someday" is missing or not a date',
    ]);
  });

  it("keeps the legacy row's own message", () => {
    const r = stagedAnyAssessmentSchema.safeParse({
      fields: { employee_name: "Ana", assessment_date: "nope" },
      raw: {},
    });
    expect(messages(r).join()).toMatch(/Assessment Date "nope"/);
  });

  it("keeps the status row's own message", () => {
    const r = stagedAnyProgressSchema.safeParse({
      format: "assessment_status",
      fields: {
        employee_name: "Ana",
        period: "H1",
        self_status: "Completado",
        manager_status: null,
      },
    });
    expect(messages(r).join()).toMatch(/Period "H1"/);
  });
});
