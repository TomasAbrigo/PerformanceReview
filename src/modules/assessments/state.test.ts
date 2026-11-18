import { describe, expect, it } from "vitest";
import { isProgressFilter, participantProgress, requestState } from "./state";

describe("requestState", () => {
  it("is none without a request", () => {
    expect(requestState(null, true)).toBe("none");
    expect(requestState(null, false)).toBe("none");
  });

  it("is the request's status when the actor may read it", () => {
    expect(requestState({ status: "submitted" }, true)).toBe("submitted");
    expect(requestState({ status: "draft" }, true)).toBe("draft");
    expect(requestState({ status: "declined" }, true)).toBe("declined");
  });

  it("is locked, whatever the status, when the actor may not read it yet", () => {
    for (const status of ["submitted", "draft", "declined"] as const) {
      expect(requestState({ status }, false)).toBe("locked");
    }
  });
});

describe("participantProgress", () => {
  it("is complete with both sides submitted", () => {
    expect(participantProgress("submitted", "submitted")).toBe("complete");
  });

  it("is partial with exactly one side submitted", () => {
    expect(participantProgress("submitted", "draft")).toBe("partial");
    expect(participantProgress("locked", "submitted")).toBe("partial");
  });

  it("is pending with none", () => {
    expect(participantProgress("draft", "none")).toBe("pending");
    expect(participantProgress("locked", "locked")).toBe("pending");
  });
});

describe("isProgressFilter", () => {
  it("accepts the three progress values", () => {
    expect(["complete", "partial", "pending"].every(isProgressFilter)).toBe(
      true,
    );
    expect(isProgressFilter("all")).toBe(false);
  });
});
