import { describe, expect, it } from "vitest";
import { groupIdentity, orgDimOf, withoutPersonFilters } from "./kinds";

/** Stands in for the install's keyed hash (see group-key.test). */
const keyOf = (value: string) => `k-${value.length}-${value.charCodeAt(0)}`;

describe("groupIdentity", () => {
  it("keeps the value of a group as key and label", () => {
    expect(groupIdentity("account", "Cuenta A", false)).toEqual({
      key: "Cuenta A",
      label: "Cuenta A",
    });
    expect(groupIdentity("dm", "Ana Prieto", false)).toEqual({
      key: "Ana Prieto",
      label: "Ana Prieto",
    });
  });

  it("gives direction a team, never the name of a DM or a Santex Lead", () => {
    const dm = groupIdentity("dm", "Ana Prieto", true, keyOf);
    expect(dm.label).toBeNull();
    expect(dm.key).toBe(keyOf("Ana Prieto"));
    expect(dm.key).not.toContain("Ana");
    expect(
      groupIdentity("santex_lead", "Ana Prieto", true, keyOf).label,
    ).toBeNull();
    // An account is not a person: it needs no keyer.
    expect(groupIdentity("account", "Cuenta A", true).label).toBe("Cuenta A");
  });

  it("does not mask without a keyer: it refuses instead of leaking the name", () => {
    expect(() => groupIdentity("dm", "Ana Prieto", true)).toThrow(/keyer/);
  });

  it("has no group for a person without the attribute", () => {
    expect(groupIdentity("dm", null, true, keyOf)).toEqual({
      key: null,
      label: null,
    });
  });
});

describe("orgDimOf", () => {
  it("reads the dimension a groupBy names", () => {
    const dims = { account: "A", project: "P", dm: "D", santexLead: "L" };
    expect(orgDimOf(dims, "account")).toBe("A");
    expect(orgDimOf(dims, "santex_lead")).toBe("L");
  });
});

describe("withoutPersonFilters", () => {
  const filters = {
    account: "Cuenta A",
    project: "Proyecto A1",
    dm: "Diego",
    santexLead: "Lía",
    department: "Ingeniería",
  };

  it("takes the DM and the Santex Lead from direction's filters and keeps the rest", () => {
    expect(withoutPersonFilters(filters, true)).toEqual({
      account: "Cuenta A",
      project: "Proyecto A1",
      dm: undefined,
      santexLead: undefined,
      department: "Ingeniería",
    });
  });

  it("leaves everybody else's alone", () => {
    expect(withoutPersonFilters(filters, false)).toBe(filters);
  });
});
