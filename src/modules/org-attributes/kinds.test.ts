import { describe, expect, it } from "vitest";
import { groupIdentity, opaqueKey, orgDimOf } from "./kinds";

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
    const dm = groupIdentity("dm", "Ana Prieto", true);
    expect(dm.label).toBeNull();
    expect(dm.key).toBe(opaqueKey("Ana Prieto"));
    expect(dm.key).not.toContain("Ana");
    expect(groupIdentity("santex_lead", "Ana Prieto", true).label).toBeNull();
    // An account is not a person.
    expect(groupIdentity("account", "Cuenta A", true).label).toBe("Cuenta A");
  });

  it("keys equal values equally and different ones apart", () => {
    expect(opaqueKey("Ana")).toBe(opaqueKey("Ana"));
    expect(opaqueKey("Ana")).not.toBe(opaqueKey("Anb"));
  });

  it("has no group for a person without the attribute", () => {
    expect(groupIdentity("dm", null, true)).toEqual({ key: null, label: null });
  });
});

describe("orgDimOf", () => {
  it("reads the dimension a groupBy names", () => {
    const dims = { account: "A", project: "P", dm: "D", santexLead: "L" };
    expect(orgDimOf(dims, "account")).toBe("A");
    expect(orgDimOf(dims, "santex_lead")).toBe("L");
  });
});
