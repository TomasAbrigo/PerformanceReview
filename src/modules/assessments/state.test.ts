import { describe, expect, it } from "vitest";
import { isProgressFilter, requestState } from "./state";

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

describe("isProgressFilter", () => {
  it("accepts the three progress values", () => {
    expect(["complete", "partial", "pending"].every(isProgressFilter)).toBe(
      true,
    );
    expect(isProgressFilter("all")).toBe(false);
  });
});
