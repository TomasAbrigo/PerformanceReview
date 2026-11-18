import { describe, expect, it } from "vitest";
import type { ActorContext } from "@/modules/actor/types";
import {
  type CaptureQuestion,
  canAnswer,
  checkAnswers,
  missingRequired,
} from "./rules";

const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const request = { reviewerPersonId: ME, relationship: "self" };

describe("canAnswer", () => {
  it("lets the reviewer of the request answer", () => {
    expect(canAnswer({ personId: ME, role: "employee" }, request)).toBe(true);
    expect(canAnswer({ personId: ME, role: "manager" }, request)).toBe(true);
  });

  it("lets People answer any request", () => {
    expect(canAnswer({ personId: null, role: "hr" }, request)).toBe(true);
    expect(canAnswer({ personId: OTHER, role: "hr" }, request)).toBe(true);
  });

  it.each<[string, ActorContext]>([
    ["another employee", { personId: OTHER, role: "employee" }],
    ["another manager", { personId: OTHER, role: "manager" }],
    ["direction", { personId: null, role: "direction" }],
    [
      "direction even with the reviewer's person",
      { personId: ME, role: "direction" },
    ],
    ["an actor without a person", { personId: null, role: "employee" }],
  ])("refuses %s", (_name, actor) => {
    expect(canAnswer(actor, request)).toBe(false);
  });

  it("refuses everyone but People when the reviewer is missing", () => {
    const missing = { reviewerPersonId: null, relationship: "self" };
    expect(canAnswer({ personId: null, role: "employee" }, missing)).toBe(
      false,
    );
    expect(canAnswer({ personId: null, role: "hr" }, missing)).toBe(true);
  });

  describe("a manager review", () => {
    const managerReview = { reviewerPersonId: ME, relationship: "manager" };
    const manager: ActorContext = { personId: ME, role: "manager" };

    it("is for its reviewer while still the reviewee's manager today", () => {
      expect(canAnswer(manager, managerReview, ME)).toBe(true);
    });

    it("is closed to a reviewer who no longer manages the reviewee", () => {
      expect(canAnswer(manager, managerReview, OTHER)).toBe(false);
      expect(canAnswer(manager, managerReview, null)).toBe(false);
      // Unknown today's manager: closed (never assumed).
      expect(canAnswer(manager, managerReview)).toBe(false);
    });

    it("is closed to the reviewee's current manager who is not its reviewer", () => {
      const other: ActorContext = { personId: OTHER, role: "manager" };
      expect(canAnswer(other, managerReview, OTHER)).toBe(false);
    });

    it("stays open to People", () => {
      expect(canAnswer({ personId: null, role: "hr" }, managerReview)).toBe(
        true,
      );
    });
  });
});

const label = { es: "x", en: "x" };
const rating: CaptureQuestion = {
  id: "q-rating",
  kind: "rating",
  required: true,
  scale: {
    options: [1, 2, 3, 4, 5].map((value) => ({
      value,
      label: { es: `L${value}`, en: `L${value}` },
      normalized: (value - 1) / 4,
    })),
  },
  choices: null,
};
const text: CaptureQuestion = {
  id: "q-text",
  kind: "text",
  required: false,
  scale: null,
  choices: null,
};
const choice: CaptureQuestion = {
  id: "q-choice",
  kind: "single_choice",
  required: true,
  scale: null,
  choices: [
    { value: "a", label },
    { value: "b", label },
  ],
};
const questions = [rating, text, choice];

describe("checkAnswers", () => {
  it("turns valid answers into the columns of an answer row", () => {
    const { rows, clear, issues } = checkAnswers(questions, [
      { questionRevisionId: "q-rating", value: 4 },
      { questionRevisionId: "q-text", value: "  Bien  " },
      { questionRevisionId: "q-choice", value: "b" },
    ]);
    expect(issues).toEqual([]);
    expect(clear).toEqual([]);
    expect(rows).toEqual([
      {
        questionRevisionId: "q-rating",
        optionValue: 4,
        optionLabel: "L4",
        normalized: 0.75,
        textValue: null,
      },
      {
        questionRevisionId: "q-text",
        optionValue: null,
        optionLabel: null,
        normalized: null,
        textValue: "Bien",
      },
      {
        questionRevisionId: "q-choice",
        optionValue: null,
        optionLabel: "b",
        normalized: null,
        textValue: null,
      },
    ]);
  });

  it("accepts a rating sent as a numeric string", () => {
    const { rows, issues } = checkAnswers(questions, [
      { questionRevisionId: "q-rating", value: "2" },
    ]);
    expect(issues).toEqual([]);
    expect(rows[0].optionValue).toBe(2);
  });

  it("clears an emptied answer (a draft may leave anything blank)", () => {
    const { rows, clear, issues } = checkAnswers(questions, [
      { questionRevisionId: "q-rating", value: null },
      { questionRevisionId: "q-text", value: "   " },
    ]);
    expect(issues).toEqual([]);
    expect(rows).toEqual([]);
    expect(clear).toEqual(["q-rating", "q-text"]);
  });

  it("rejects a value outside the scale, an unknown choice and an unknown question", () => {
    const { issues } = checkAnswers(questions, [
      { questionRevisionId: "q-rating", value: 6 },
      { questionRevisionId: "q-choice", value: "z" },
      { questionRevisionId: "q-nope", value: "x" },
    ]);
    expect(issues).toEqual([
      { path: "q-rating", message: "out_of_scale" },
      { path: "q-choice", message: "invalid_choice" },
      { path: "q-nope", message: "unknown_question" },
    ]);
  });

  it("rejects a non-numeric rating", () => {
    expect(
      checkAnswers(questions, [{ questionRevisionId: "q-rating", value: "x" }])
        .issues,
    ).toEqual([{ path: "q-rating", message: "out_of_scale" }]);
  });
});

describe("missingRequired", () => {
  it("lists the required questions without an answer, in order", () => {
    expect(missingRequired(questions, new Set(["q-text"]))).toEqual([
      { path: "q-rating", message: "required" },
      { path: "q-choice", message: "required" },
    ]);
    expect(
      missingRequired(questions, new Set(["q-rating", "q-choice"])),
    ).toEqual([]);
  });
});
