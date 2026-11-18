import { describe, expect, it } from "vitest";
import { canBrowseIndividuals, individualScope } from "./individual-scope";

const person = "11111111-1111-4111-8111-111111111111";

describe("individualScope", () => {
  it("lets People read everybody", () => {
    expect(individualScope({ personId: null, role: "hr" })).toEqual({
      kind: "all",
    });
    expect(individualScope({ personId: person, role: "hr" })).toEqual({
      kind: "all",
    });
  });

  it("gives a manager their team (and themself)", () => {
    expect(individualScope({ personId: person, role: "manager" })).toEqual({
      kind: "team",
      personId: person,
    });
  });

  it("gives an employee only themself", () => {
    expect(individualScope({ personId: person, role: "employee" })).toEqual({
      kind: "own",
      personId: person,
    });
  });

  it("gives nothing to direction (aggregates only) nor to a person-less manager or employee", () => {
    expect(individualScope({ personId: null, role: "direction" })).toEqual({
      kind: "none",
    });
    expect(individualScope({ personId: null, role: "manager" })).toEqual({
      kind: "none",
    });
    expect(individualScope({ personId: null, role: "employee" })).toEqual({
      kind: "none",
    });
  });

  it("tells who may browse individual goals and assessments", () => {
    expect(canBrowseIndividuals({ personId: null, role: "hr" })).toBe(true);
    expect(canBrowseIndividuals({ personId: person, role: "manager" })).toBe(
      true,
    );
    expect(canBrowseIndividuals({ personId: person, role: "employee" })).toBe(
      true,
    );
    expect(canBrowseIndividuals({ personId: null, role: "direction" })).toBe(
      false,
    );
  });
});
