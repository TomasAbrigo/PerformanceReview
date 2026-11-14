import { describe, expect, it } from "vitest";
import { answerColumns, detectQuestionColumns } from "./questions";

const HEADERS = [
  "Employee Name",
  "Manager",
  "Employee Q1: How well does Meridian Andina recognize my value?",
  "Employee Q2: What would have the greatest impact on my ability to do my best work more often?",
  "Employee Q3: What are some things I do well?",
  "Employee Q4: How could I improve?",
  "Manager Q1: If [Employee] got a job offer elsewhere, I would...",
  "Manager Q2: How engaged is [Employee] at work?",
  "Manager Q3: What are some things [Employee] does well?",
  "Manager Q4: How could [Employee] improve?",
  "Employee Custom Q1: Mis objetivos del período están claros.",
  "Manager Custom Q1: Los objetivos de [Employee] para el período están claros.",
];

describe("detectQuestionColumns", () => {
  const columns = detectQuestionColumns(HEADERS);
  const byKey = new Map(columns.map((c) => [c.key, c]));

  it("finds the 4 standard self and manager questions and the custom ones", () => {
    expect(columns.map((c) => c.key)).toEqual([
      "self:q1",
      "self:q2",
      "self:q3",
      "self:q4",
      "self:custom:1:mis objetivos del período están claros.",
      "manager:q1",
      "manager:q2",
      "manager:q3",
      "manager:q4",
      "manager:custom:1:los objetivos de [employee] para el período están claros.",
    ]);
    expect(columns.map((c) => c.sort)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("standard Q1/Q2 are single choice with Bamboo's options; Q3/Q4 free text", () => {
    const q1 = byKey.get("self:q1")!;
    expect(q1.kind).toBe("single_choice");
    expect(q1.choices?.map((c) => c.value)).toEqual(["A", "B", "C", "D"]);
    expect(q1.choices?.[0].label.en).toBe("I feel highly valued");
    expect(byKey.get("manager:q1")!.choices).toHaveLength(5);
    expect(byKey.get("self:q3")!.kind).toBe("text");
    expect(q1.prompt.en).toBe(
      "How well does Meridian Andina recognize my value?",
    );
  });

  it("the employee never sees manager Q1/Q2", () => {
    expect(byKey.get("manager:q1")!.visibleToReviewee).toBe(false);
    expect(byKey.get("manager:q2")!.visibleToReviewee).toBe(false);
    expect(byKey.get("manager:q3")!.visibleToReviewee).toBe(true);
    expect(byKey.get("self:q1")!.visibleToReviewee).toBe(true);
    expect(byKey.get("manager:q1")!.relationship).toBe("manager");
  });

  it("custom questions are 1-5 ratings with a normalized scale", () => {
    const custom = byKey.get(
      "manager:custom:1:los objetivos de [employee] para el período están claros.",
    )!;
    expect(custom.kind).toBe("rating");
    expect(custom.scale?.options.map((o) => [o.value, o.normalized])).toEqual([
      [1, 0],
      [2, 0.25],
      [3, 0.5],
      [4, 0.75],
      [5, 1],
    ]);
  });
});

describe("answerColumns", () => {
  const [q1, , q3, , custom] = detectQuestionColumns(HEADERS);

  it("keeps the letter of a choice (known letters only)", () => {
    expect(answerColumns(q1, "B")).toMatchObject({ optionLabel: "B" });
    expect(answerColumns(q1, " b ")).toMatchObject({ optionLabel: "B" });
    expect(answerColumns(q1, "Z")).toEqual({ invalid: true });
  });

  it("maps ratings to value, label and normalized value", () => {
    expect(answerColumns(custom, "4")).toEqual({
      optionValue: 4,
      optionLabel: "De acuerdo",
      normalized: 0.75,
      textValue: null,
    });
    expect(answerColumns(custom, 5)).toMatchObject({ normalized: 1 });
    expect(answerColumns(custom, "7")).toEqual({ invalid: true });
  });

  it("keeps free text and skips empty cells", () => {
    expect(answerColumns(q3, "Muy bien")).toMatchObject({
      textValue: "Muy bien",
    });
    expect(answerColumns(q3, null)).toBeNull();
    expect(answerColumns(q3, "  ")).toBeNull();
  });
});

describe("custom question keys", () => {
  it("include the question number, so two custom questions with the same text do not collide", () => {
    const keys = detectQuestionColumns([
      "Employee Custom Q1: Claridad.",
      "Employee Custom Q2: Claridad.",
    ]).map((c) => c.key);
    expect(keys).toEqual([
      "self:custom:1:claridad.",
      "self:custom:2:claridad.",
    ]);
  });
});
