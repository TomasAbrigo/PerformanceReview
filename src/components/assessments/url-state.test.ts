import { describe, expect, it } from "vitest";
import { parseAssessmentView, parseAssessmentsParams } from "./url-state";

describe("parseAssessmentsParams", () => {
  it("reads every filter of the list", () => {
    expect(
      parseAssessmentsParams({
        cycle: "c1",
        progress: "partial",
        q: " eli ",
        department: "Tecnología",
        dm: "Dana",
        page: "2",
      }),
    ).toMatchObject({
      cycle: "c1",
      progress: "partial",
      q: "eli",
      department: "Tecnología",
      dm: "Dana",
      page: 2,
    });
  });

  it("drops an unknown progress, a bad page and empty text", () => {
    expect(
      parseAssessmentsParams({ progress: "done", page: "0", q: " " }),
    ).toMatchObject({ progress: undefined, page: 1, q: undefined });
  });
});

describe("parseAssessmentView", () => {
  it("is the full view unless the employee's is asked for", () => {
    expect(parseAssessmentView({})).toBe("full");
    expect(parseAssessmentView({ view: "employee" })).toBe("employee");
    expect(parseAssessmentView({ view: "other" })).toBe("full");
  });
});
