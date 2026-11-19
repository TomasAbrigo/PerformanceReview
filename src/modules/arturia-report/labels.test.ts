import { describe, expect, it } from "vitest";
import { signals } from "@/modules/qualitative-analysis/constants";
import {
  COMPETENCY_THEMES,
  IMPACT_THEMES,
  INITIAL_THEMES,
} from "@/modules/qualitative-analysis/themes";
import {
  humanize,
  questionLabel,
  readingNames,
  santexQuestionName,
  signalLabel,
  substanceLabel,
  themeLabel,
} from "./labels";

/** The question texts the Bamboo import stores, per the real reports (English both ways). */
const PROMPTS = {
  security: {
    es: "Am I following all Information Security Policies and Procedures of the Company?",
    en: "Am I following all Information Security Policies and Procedures of the Company?",
  },
  social: {
    es: 'Do I contribute with initiatives related to "Social impact"? How?',
    en: 'Do I contribute with initiatives related to "Social impact"? How?',
  },
  environmental: {
    es: 'Do I contribute with initiatives related to "Environmental impact"? How?',
    en: 'Do I contribute with initiatives related to "Environmental impact"? How?',
  },
  conversations: {
    es: "Do I speak with this employee frequently enough that I consider myself to be aware of his/her needs and current situation?",
    en: "Do I speak with this employee frequently enough that I consider myself to be aware of his/her needs and current situation?",
  },
};

const keysOf = (o: unknown, prefix = ""): string[] =>
  typeof o === "object" && o !== null
    ? Object.entries(o).flatMap(([k, v]) => keysOf(v, `${prefix}${k}.`))
    : [prefix];

describe("the report's vocabulary of the open-text reading", () => {
  it("es and en have the same keys and no empty text", () => {
    expect(keysOf(readingNames("es")).sort()).toEqual(
      keysOf(readingNames("en")).sort(),
    );
    for (const locale of ["es", "en"] as const) {
      const walk = (o: unknown) => {
        if (typeof o === "string") expect(o.trim()).not.toBe("");
        else if (typeof o === "object" && o !== null)
          Object.values(o).forEach(walk);
      };
      walk(readingNames(locale));
    }
  });

  it("names every theme of the vocabulary, every signal and every substance, in both languages", () => {
    for (const locale of ["es", "en"] as const) {
      for (const theme of [
        ...INITIAL_THEMES,
        ...COMPETENCY_THEMES,
        ...IMPACT_THEMES,
        "colaboracion",
      ]) {
        // a name of its own, not the humanized key
        expect(readingNames(locale).themes).toHaveProperty(theme);
      }
      for (const s of signals) {
        expect(readingNames(locale).signals).toHaveProperty(s);
        expect(signalLabel(s, locale)).not.toBe(s);
      }
      for (const s of ["none", "generic", "specific"]) {
        expect(substanceLabel(s, locale)).not.toBe(s);
      }
    }
    expect(themeLabel("comunicacion", "es")).toBe("Comunicación");
    expect(themeLabel("comunicacion", "en")).toBe("Communication");
  });

  it("a theme or signal nobody named reads humanized, never as a key", () => {
    expect(themeLabel("salud_mental", "es")).toBe("Salud mental");
    expect(signalLabel("burn_out", "en")).toBe("Burn out");
    expect(humanize("")).toBe("");
  });

  it("tells the four Santex yes/no questions apart by their own text", () => {
    expect(santexQuestionName(PROMPTS.security, "es")).toBe(
      "Seguridad de la información",
    );
    expect(santexQuestionName(PROMPTS.conversations, "es")).toBe(
      "Conversaciones frecuentes",
    );
    expect(santexQuestionName(PROMPTS.social, "es")).toBe("Impacto social");
    expect(santexQuestionName(PROMPTS.environmental, "es")).toBe(
      "Impacto ambiental",
    );
    expect(santexQuestionName(PROMPTS.social, "en")).toBe("Social impact");
    expect(santexQuestionName(PROMPTS.environmental, "en")).toBe(
      "Environmental impact",
    );
    expect(
      santexQuestionName({ es: "¿Qué tal el clima?", en: "How is it?" }, "es"),
    ).toBeNull();
  });

  it("names a question key: its own name, the Santex name, the prompt, or a pattern; never the raw slug", () => {
    expect(questionLabel("strengths", undefined, "es")).toBe("Fortalezas");
    expect(questionLabel("best_work", undefined, "en")).toContain("best work");
    const slug = "custom_am_i_following_all_information_security_02c50291";
    expect(questionLabel(slug, PROMPTS.security, "en")).toBe(
      "Information security",
    );
    expect(
      questionLabel(
        "custom_x_ab12",
        { es: "¿Tu opinión?", en: "Opinion?" },
        "es",
      ),
    ).toBe("¿Tu opinión?");
    expect(questionLabel("custom_2", undefined, "es")).toBe(
      "Pregunta personalizada 2",
    );
    expect(questionLabel("custom_2", undefined, "en")).toBe(
      "Custom question 2",
    );
  });
});
