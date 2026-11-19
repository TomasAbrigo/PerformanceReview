import { describe, expect, it } from "vitest";
import { answerDisplay, type DisplayQuestion } from "./display";

const scale = {
  options: [
    {
      value: 1,
      label: { es: "Muy en desacuerdo", en: "Strongly disagree" },
      normalized: 0,
    },
    {
      value: 2,
      label: { es: "En desacuerdo", en: "Disagree" },
      normalized: 0.25,
    },
    {
      value: 5,
      label: { es: "Muy de acuerdo", en: "Strongly agree" },
      normalized: 1,
    },
  ],
};
const letters = [
  {
    value: "A",
    label: {
      es: "Me convencería de quedarme",
      en: "I would convince them to stay",
    },
  },
  { value: "B", label: { es: "Haría el intento", en: "I would try" } },
];
const q = (over: Partial<DisplayQuestion>): DisplayQuestion => ({
  kind: "text",
  role: null,
  scale: null,
  choices: null,
  ...over,
});
const a = (over: object = {}) => ({
  optionValue: null,
  optionLabel: null,
  textValue: null,
  ...over,
});

describe("answerDisplay", () => {
  it("shows an open answer as its text", () => {
    expect(answerDisplay(q({}), a({ textValue: "Un buen año" }), "es")).toEqual(
      {
        kind: "text",
        text: "Un buen año",
      },
    );
  });

  it("is empty without an answer or with a blank one", () => {
    expect(answerDisplay(q({}), undefined, "es")).toEqual({ kind: "none" });
    expect(answerDisplay(q({}), a({ textValue: "  " }), "es")).toEqual({
      kind: "none",
    });
    expect(answerDisplay(q({ kind: "rating", scale }), a(), "es")).toEqual({
      kind: "none",
    });
  });

  it("shows a rating as the scale value out of the top of its scale, with the label in the language", () => {
    const question = q({ kind: "rating", scale });
    const answer = a({ optionValue: 2, optionLabel: "En desacuerdo" });
    expect(answerDisplay(question, answer, "es")).toEqual({
      kind: "closed",
      value: 2,
      max: 5,
      code: null,
      label: "En desacuerdo",
    });
    expect(answerDisplay(question, answer, "en")).toMatchObject({
      label: "Disagree",
    });
  });

  it("falls back to the stored label when the scale has no such option", () => {
    expect(
      answerDisplay(
        q({ kind: "rating", scale }),
        a({ optionValue: 4, optionLabel: "Casi" }),
        "es",
      ),
    ).toMatchObject({ value: 4, max: 5, label: "Casi" });
  });

  it("shows a Likert question (retention) as value/5, its letter and the option's label", () => {
    const question = q({
      kind: "single_choice",
      role: "retention",
      choices: letters,
    });
    const answer = a({ optionValue: 5, optionLabel: "A" });
    expect(answerDisplay(question, answer, "es")).toEqual({
      kind: "closed",
      value: 5,
      max: 5,
      code: "A",
      label: "Haría todo para retenerlo",
    });
    expect(answerDisplay(question, answer, "en")).toMatchObject({
      label: "Do everything to keep them",
    });
  });

  it("labels a Likert answer by its value, never by the stored text (#130)", () => {
    expect(
      answerDisplay(
        q({ kind: "single_choice", role: "engagement", choices: letters }),
        a({
          optionValue: 4,
          optionLabel: "I would try hard. Ana would be difficult to replace",
        }),
        "es",
      ),
    ).toEqual({
      kind: "closed",
      value: 4,
      max: 5,
      code: null,
      label: "Comprometido",
    });
  });

  it("shows a plain single choice as its letter and label, without a value", () => {
    expect(
      answerDisplay(
        q({ kind: "single_choice", choices: letters }),
        a({ optionLabel: "B" }),
        "es",
      ),
    ).toEqual({
      kind: "closed",
      value: null,
      max: null,
      code: "B",
      label: "Haría el intento",
    });
  });

  it("does not show a code that is only a slug of the label", () => {
    expect(
      answerDisplay(
        q({
          kind: "single_choice",
          choices: [
            {
              value: "nothing_i_have_all_i_need",
              label: {
                es: "Nada, tengo todo",
                en: "Nothing, I have all I need",
              },
            },
          ],
        }),
        a({ optionLabel: "nothing_i_have_all_i_need" }),
        "en",
      ),
    ).toEqual({
      kind: "closed",
      value: null,
      max: null,
      code: null,
      label: "Nothing, I have all I need",
    });
  });

  it("keeps the valued role on its 1-4 scale", () => {
    expect(
      answerDisplay(
        q({ kind: "single_choice", role: "valued", choices: letters }),
        a({ optionValue: 3, optionLabel: "B" }),
        "es",
      ),
    ).toMatchObject({ value: 3, max: 4 });
  });
});
