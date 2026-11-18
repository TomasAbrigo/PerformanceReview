import { describe, expect, it } from "vitest";
import { parseGoalsParams } from "./url-state";

describe("parseGoalsParams", () => {
  it("reads every filter of the list", () => {
    expect(
      parseGoalsParams({
        cycle: "c1",
        state: "overdue",
        q: " dora ",
        department: "Producto",
        dm: "Dana",
        account: "Acme",
        page: "3",
      }),
    ).toEqual({
      cycle: "c1",
      state: "overdue",
      q: "dora",
      department: "Producto",
      dm: "Dana",
      account: "Acme",
      project: undefined,
      santexLead: undefined,
      page: 3,
    });
  });

  it("drops what is not a filter value: an unknown state, a bad page, empty text", () => {
    expect(
      parseGoalsParams({ state: "done", page: "-2", q: "  ", cycle: "" }),
    ).toMatchObject({
      state: undefined,
      page: 1,
      q: undefined,
      cycle: undefined,
    });
    expect(parseGoalsParams({ page: "abc" }).page).toBe(1);
  });

  it("takes the first of a repeated param", () => {
    expect(parseGoalsParams({ state: ["closed", "completed"] }).state).toBe(
      "closed",
    );
  });
});
