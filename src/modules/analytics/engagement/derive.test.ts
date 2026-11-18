import { describe, expect, it } from "vitest";
import { buildMonths, maskedMonth, openMonth } from "./derive";
import type { MonthCounts, SegmentCounts } from "./types";

const month = (
  over: Omit<Partial<MonthCounts>, "segments"> & {
    segments?: Partial<SegmentCounts>;
  } = {},
): MonthCounts => {
  const segments: SegmentCounts = {
    alto: 10,
    medio: 20,
    regular: 10,
    bajo: 5,
    falta: 5,
    ...over.segments,
  };
  const people = Object.values(segments).reduce((a, b) => a + b, 0);
  const respondents = people - segments.falta;
  return {
    month: "2026-03-01",
    people,
    respondents,
    scored: respondents,
    mean: 0.64,
    ...over,
    segments,
  };
};

describe("openMonth", () => {
  it("shows everything: participation is respondents over people", () => {
    expect(openMonth(month())).toEqual({
      month: "2026-03-01",
      hidden: false,
      people: 50,
      respondents: 45,
      participation: 0.9,
      mean: 0.64,
      segments: { alto: 10, medio: 20, regular: 10, bajo: 5, falta: 5 },
    });
  });

  it("has no participation without people", () => {
    expect(
      openMonth(month({ people: 0, respondents: 0, scored: 0, mean: null }))
        .participation,
    ).toBeNull();
  });
});

describe("maskedMonth (direction)", () => {
  it("shows a month with enough people, scores and cells", () => {
    expect(maskedMonth(month(), 5)).toMatchObject({
      hidden: false,
      people: 50,
      participation: 0.9,
      mean: 0.64,
      segments: { alto: 10, bajo: 5, falta: 5 },
    });
  });

  it("hides a month under the minimum number of people", () => {
    const small = month({
      segments: { alto: 1, medio: 1, regular: 1, bajo: 0, falta: 1 },
    });
    expect(maskedMonth(small, 5)).toEqual({
      month: "2026-03-01",
      hidden: true,
      people: null,
      respondents: null,
      participation: null,
      mean: null,
      segments: null,
    });
  });

  it("hides a month with fewer scores than the minimum, even with enough people", () => {
    expect(
      maskedMonth(
        month({
          segments: { alto: 2, medio: 1, regular: 0, bajo: 0, falta: 20 },
        }),
        5,
      ).hidden,
    ).toBe(true);
  });

  it("drops the segments when a non-empty cell is under the minimum, keeping the rest", () => {
    const masked = maskedMonth(month({ segments: { bajo: 2 } }), 5);
    expect(masked.segments).toBeNull();
    expect(masked.hidden).toBe(false);
    expect(masked.mean).toBe(0.64);
    expect(masked.participation).not.toBeNull();
  });

  it("an empty cell is not a small group", () => {
    expect(maskedMonth(month({ segments: { bajo: 0 } }), 5).segments).toEqual({
      alto: 10,
      medio: 20,
      regular: 10,
      bajo: 0,
      falta: 5,
    });
  });

  it("drops participation when the falta cell it gives away is under the minimum", () => {
    const masked = maskedMonth(month({ segments: { falta: 2 } }), 5);
    expect(masked.participation).toBeNull();
    expect(masked.respondents).toBeNull();
    expect(masked.segments).toBeNull();
    expect(masked.mean).toBe(0.64);
  });

  it("keeps participation when nobody is missing", () => {
    expect(
      maskedMonth(month({ segments: { falta: 0 } }), 5).participation,
    ).toBe(1);
  });
});

describe("buildMonths", () => {
  const rows = [
    month({ month: "2026-01-01" }),
    month({
      month: "2026-02-01",
      segments: { alto: 1, medio: 1, regular: 1, bajo: 0, falta: 0 },
    }),
  ];

  it("reads everything without a minimum", () => {
    const { months, hiddenMonths } = buildMonths(rows, null);
    expect(hiddenMonths).toBe(0);
    expect(months.map((m) => m.hidden)).toEqual([false, false]);
  });

  it("counts the hidden months for direction", () => {
    const { months, hiddenMonths } = buildMonths(rows, 5);
    expect(months.map((m) => m.hidden)).toEqual([false, true]);
    expect(hiddenMonths).toBe(1);
  });
});
