import { describe, expect, it } from "vitest";
import { actorRoles, DEFAULT_ACTOR, parseActor } from "./types";

const ID = "00000000-0000-4000-8000-000000000002";

describe("parseActor", () => {
  it("defaults to HR without a person", () => {
    expect(parseActor(undefined)).toEqual({ personId: null, role: "hr" });
    expect(DEFAULT_ACTOR).toEqual({ personId: null, role: "hr" });
  });
  it("reads a valid cookie", () => {
    expect(
      parseActor(JSON.stringify({ personId: ID, role: "employee" })),
    ).toEqual({ personId: ID, role: "employee" });
  });
  it("falls back to the default on garbage", () => {
    expect(parseActor("{")).toEqual(DEFAULT_ACTOR);
    expect(parseActor(JSON.stringify({ personId: "x", role: "god" }))).toEqual(
      DEFAULT_ACTOR,
    );
  });
});

describe("actorRoles", () => {
  it("are People (hr), manager and employee only", () => {
    expect(actorRoles).toEqual(["hr", "manager", "employee"]);
  });
  it("rejects the removed peer and calibrator roles", () => {
    for (const role of ["peer", "calibrator"]) {
      expect(parseActor(JSON.stringify({ personId: ID, role }))).toEqual(
        DEFAULT_ACTOR,
      );
    }
  });
});
