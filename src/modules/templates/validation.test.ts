import { describe, expect, it } from "vitest";
import { questionInput } from "./validation";

const likert = {
  kind: "rating" as const,
  appliesTo: ["manager" as const],
  visibleToReviewee: false,
  prompt: { es: "Retención", en: "Retention" },
  scaleId: "00000000-0000-4000-8000-000000000000",
  role: "retention" as const,
};

const messages = (input: unknown) => {
  const parsed = questionInput.safeParse(input);
  return parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
};

describe("questionInput: retention and engagement roles", () => {
  it("accepts a manager-only rating hidden from the reviewee", () => {
    expect(messages(likert)).toEqual([]);
    expect(messages({ ...likert, role: "engagement" })).toEqual([]);
  });

  it("requires a rating", () => {
    expect(messages({ ...likert, kind: "text", scaleId: null })).toContain(
      "role:only_for_rating",
    );
  });

  it("requires the manager only", () => {
    expect(messages({ ...likert, appliesTo: ["manager", "self"] })).toContain(
      "appliesTo:manager_only",
    );
  });

  it("requires it hidden from the reviewee", () => {
    expect(messages({ ...likert, visibleToReviewee: true })).toContain(
      "visibleToReviewee:hidden_required",
    );
  });

  it("accepts a dimension and rejects an unknown one", () => {
    const open = {
      kind: "text",
      appliesTo: ["self"],
      prompt: { es: "x", en: "x" },
    };
    expect(messages({ ...open, dimension: "strengths" })).toEqual([]);
    expect(messages({ ...open, dimension: "custom_3" })).toEqual([]);
    expect(messages({ ...open, dimension: "nope" })).not.toEqual([]);
  });
});
