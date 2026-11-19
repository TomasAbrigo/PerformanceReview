import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultLikertMappings,
  LIKERT_ROLE_MAX,
  likertLabel,
  likertRoles,
  mapLikert,
  storedLikertLabel,
} from "./index";

describe("defaultLikertMappings", () => {
  it("maps A-E to 5..1 and A-D to 5,4,2,1 for both roles", () => {
    for (const role of ["retention", "engagement"] as const) {
      expect(defaultLikertMappings[role][5]).toEqual({
        A: 5,
        B: 4,
        C: 3,
        D: 2,
        E: 1,
      });
      expect(defaultLikertMappings[role][4]).toEqual({
        A: 5,
        B: 4,
        C: 2,
        D: 1,
      });
    }
  });
});

describe("mapLikert", () => {
  it("maps letters of a 5-option set", () => {
    expect(mapLikert({ role: "retention", optionCount: 5, raw: "A" })).toEqual({
      value: 5,
      normalized: 1,
    });
    expect(mapLikert({ role: "engagement", optionCount: 5, raw: "c" })).toEqual(
      { value: 3, normalized: 0.5 },
    );
    expect(
      mapLikert({ role: "retention", optionCount: 5, raw: " E " }),
    ).toEqual({ value: 1, normalized: 0 });
  });

  it("maps letters of a 4-option set, skipping the middle", () => {
    expect(mapLikert({ role: "retention", optionCount: 4, raw: "C" })).toEqual({
      value: 2,
      normalized: 0.25,
    });
    expect(mapLikert({ role: "engagement", optionCount: 4, raw: "D" })).toEqual(
      { value: 1, normalized: 0 },
    );
  });

  it("takes the option count from the options when given", () => {
    expect(
      mapLikert({ role: "retention", options: ["A", "B", "C", "D"], raw: "B" }),
    ).toEqual({ value: 4, normalized: 0.75 });
  });

  it("defaults to the 5-option set", () => {
    expect(mapLikert({ role: "retention", raw: "D" })).toEqual({
      value: 2,
      normalized: 0.25,
    });
  });

  it("passes numbers 1..5 through", () => {
    expect(mapLikert({ role: "engagement", raw: "4" })).toEqual({
      value: 4,
      normalized: 0.75,
    });
    expect(mapLikert({ role: "retention", optionCount: 4, raw: "1" })).toEqual({
      value: 1,
      normalized: 0,
    });
  });

  it("matches Bamboo option labels in es and en, ignoring case and accents", () => {
    expect(
      mapLikert({ role: "retention", raw: "do everything to keep them" }),
    ).toEqual({ value: 5, normalized: 1 });
    expect(
      mapLikert({ role: "retention", raw: "Me sentiria ALIVIADO" }),
    ).toEqual({ value: 1, normalized: 0 });
    expect(mapLikert({ role: "engagement", raw: "Highly engaged" })).toEqual({
      value: 5,
      normalized: 1,
    });
    expect(mapLikert({ role: "engagement", raw: "algo comprometido" })).toEqual(
      { value: 3, normalized: 0.5 },
    );
  });

  it("rejects numbers above the option count and applies overrides to numbers", () => {
    expect(mapLikert({ role: "engagement", optionCount: 4, raw: "5" })).toEqual(
      { unmapped: true },
    );
    expect(
      mapLikert({ role: "engagement", raw: "3" }, { engagement: { "5:3": 4 } }),
    ).toEqual({ value: 4, normalized: 0.75 });
  });

  it("reports letters, numbers and text outside the table as unmapped", () => {
    expect(mapLikert({ role: "retention", optionCount: 4, raw: "E" })).toEqual({
      unmapped: true,
    });
    expect(mapLikert({ role: "retention", raw: "F" })).toEqual({
      unmapped: true,
    });
    expect(mapLikert({ role: "engagement", raw: "6" })).toEqual({
      unmapped: true,
    });
    expect(mapLikert({ role: "engagement", raw: "maybe" })).toEqual({
      unmapped: true,
    });
    expect(mapLikert({ role: "engagement", raw: "" })).toEqual({
      unmapped: true,
    });
  });

  it("applies overrides by option, or by option count and option", () => {
    const overrides = {
      retention: { "4:C": 3, F: 1 },
      engagement: { A: 4 },
    };
    expect(
      mapLikert({ role: "retention", optionCount: 4, raw: "C" }, overrides),
    ).toEqual({ value: 3, normalized: 0.5 });
    expect(
      mapLikert({ role: "retention", optionCount: 5, raw: "C" }, overrides),
    ).toEqual({ value: 3, normalized: 0.5 });
    expect(mapLikert({ role: "retention", raw: "f" }, overrides)).toEqual({
      value: 1,
      normalized: 0,
    });
    expect(mapLikert({ role: "engagement", raw: "A" }, overrides)).toEqual({
      value: 4,
      normalized: 0.75,
    });
  });

  it("ignores override values outside 1..5", () => {
    expect(
      mapLikert({ role: "retention", raw: "A" }, { retention: { A: 9 } }),
    ).toEqual({ unmapped: true });
  });
});

describe("mapLikert: Bamboo raw report labels (#83)", () => {
  const value = (role: "retention" | "engagement" | "valued", raw: string) => {
    const r = mapLikert({ role, raw });
    return "value" in r ? r.value : null;
  };

  it("maps the valued labels to 1-4", () => {
    expect(value("valued", "I feel I am highly valued.")).toBe(4);
    expect(value("valued", "I sometimes feel valued.")).toBe(3);
    expect(value("valued", "I'm not sure others value me.")).toBe(2);
    expect(value("valued", "I don't feel valued.")).toBe(1);
    expect(
      mapLikert({ role: "valued", raw: "I feel I am highly valued." }),
    ).toEqual({ value: 4, normalized: 1 });
    expect(mapLikert({ role: "valued", raw: "D" })).toEqual({
      value: 1,
      normalized: 0,
    });
  });

  it("maps retention labels by prefix or keywords, ignoring the name", () => {
    expect(value("retention", "I would do everything I can to keep them")).toBe(
      5,
    );
    expect(
      value(
        "retention",
        "I would try to convince them to stay. Lucía Gómez would be difficult to replace",
      ),
    ).toBe(4);
    expect(value("retention", "I would wish them well.")).toBe(2);
    expect(value("retention", "I would be relieved.")).toBe(1);
  });

  it("maps engagement labels", () => {
    expect(value("engagement", "Highly engaged and a great attitude.")).toBe(5);
    expect(value("engagement", "Engaged and a good attitude.")).toBe(4);
    expect(value("engagement", "Medium engagement and an okay attitude.")).toBe(
      3,
    );
    expect(value("engagement", "Low engagement and a poor attitude.")).toBe(2);
  });

  it("leaves unknown labels unmapped", () => {
    expect(mapLikert({ role: "engagement", raw: "Who knows" })).toEqual({
      unmapped: true,
    });
  });
});

describe("storedLikertLabel and likertLabel (#130)", () => {
  const named =
    "I would try to convince them to stay. Ana Pérez would be difficult to replace";

  it("never stores the reviewee's name: the canonical label of the value", () => {
    const mapped = mapLikert({ role: "retention", raw: named });
    expect(mapped).toEqual({ value: 4, normalized: 0.75 });
    const stored = storedLikertLabel("retention", named, 4);
    expect(stored).toBe("I would try to convince them to stay.");
    expect(stored).not.toContain("Ana");
    // It maps back to the same value: re-applying the equivalences works.
    expect(mapLikert({ role: "retention", raw: stored })).toEqual(mapped);
  });

  it("keeps letters and numbers as they came (the equivalence table maps them)", () => {
    expect(storedLikertLabel("engagement", " c ", 3)).toBe("C");
    expect(storedLikertLabel("engagement", "4", 4)).toBe("4");
  });

  it("every canonical label maps back to its value, for every role", () => {
    for (const role of likertRoles) {
      for (let v = 1; v <= LIKERT_ROLE_MAX[role]; v++) {
        const stored = storedLikertLabel(role, "free text", v);
        expect(mapLikert({ role, raw: stored })).toMatchObject({ value: v });
      }
    }
  });

  it("labels a value in the view's language", () => {
    expect(likertLabel("retention", 4, "es")).toBe(
      "Intentaría convencerlo de quedarse",
    );
    expect(likertLabel("retention", 4, "en")).toBe(
      "Try to convince them to stay",
    );
    expect(likertLabel("engagement", 5, "es")).toBe("Muy comprometido");
    expect(likertLabel("valued", 5, "es")).toBeNull();
    expect(likertLabel("retention", null, "es")).toBeNull();
  });

  it("the data migration writes the same canonical labels", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "drizzle/0028_likert_canonical_labels.sql"),
      "utf8",
    );
    for (const role of likertRoles) {
      const block = migration.match(
        new RegExp(`WHEN '${role}' THEN \\(ARRAY\\[([\\s\\S]*?)\\]\\)`),
      )![1];
      const labels = [...block.matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
        m[1].replace(/''/g, "'"),
      );
      expect(labels).toEqual(
        Array.from({ length: LIKERT_ROLE_MAX[role] }, (_, i) =>
          storedLikertLabel(role, "text", i + 1),
        ),
      );
    }
  });
});
