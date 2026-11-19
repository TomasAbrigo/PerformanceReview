// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_PROMPT_VERSION,
  AnthropicProvider,
  createProvider,
  DEFAULT_ANALYSIS_MODEL,
  type MessagesClient,
} from "./anthropic-provider";
import { MockProvider } from "./mock-provider";
import type { AnalysisInput } from "./provider";
import { COMPETENCY_THEMES, IMPACT_THEMES, INITIAL_THEMES } from "./themes";

const reply = (results: unknown) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify({ results }) }],
});

const item = (
  token: string,
  text: string,
  extra: Partial<AnalysisInput> = {},
): AnalysisInput => ({
  token,
  dimension: "strengths",
  rubric: "strengths",
  question: { es: "¿Qué hago bien?", en: "What do I do well?" },
  relationship: "self",
  yesNo: null,
  text,
  ...extra,
});

const label = (token: string, extra: Record<string, unknown> = {}) => ({
  token,
  substance: "generic",
  themes: [],
  signals: [],
  sentiment: "neutral",
  confidence: 0.5,
  ...extra,
});

describe("createProvider", () => {
  it("defaults to the mock and never builds Anthropic without the flag", () => {
    expect(createProvider({})).toBeInstanceOf(MockProvider);
    expect(createProvider({ ANTHROPIC_API_KEY: "k" })).toBeInstanceOf(
      MockProvider,
    );
  });
  it("with the flag and no key fails with a clear error", () => {
    expect(() => createProvider({ ANALYSIS_PROVIDER: "anthropic" })).toThrow(
      /missing_api_key: ANTHROPIC_API_KEY/,
    );
    expect(() => createProvider({ ANALYSIS_PROVIDER: "x" })).toThrow(
      /unknown_provider/,
    );
  });
  it("with flag and key builds the Anthropic provider (model override)", () => {
    const p = createProvider(
      {
        ANALYSIS_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "k",
        ANALYSIS_MODEL: "m",
      },
      { client: { create: vi.fn() } },
    );
    expect(p).toBeInstanceOf(AnthropicProvider);
    expect(p.model).toBe("m");
    expect(
      createProvider({ ANTHROPIC_API_KEY: "k" }, { override: "anthropic" })
        .model,
    ).toBe(DEFAULT_ANALYSIS_MODEL);
  });
});

describe("AnthropicProvider", () => {
  it("sends one structured-output request per batch and maps the reading by token", async () => {
    const create = vi.fn<MessagesClient["create"]>().mockResolvedValue(
      reply([
        label("t2", {
          substance: "specific",
          sentiment: "negative",
          confidence: 1.4,
          themes: ["a", "b", "c", "d"],
          signals: ["workload", "workload", "attrition"],
        }),
        label("t1", {
          sentiment: "positive",
          confidence: 0.9,
          themes: ["calidad"],
        }),
      ]),
    );
    const p = new AnthropicProvider({ create });
    const out = await p.analyze([
      item("t1", "[P1] es genial"),
      item("t2", "llego tarde, hago horas extra", { rubric: "improvement" }),
    ]);
    expect(out).toEqual([
      {
        token: "t1",
        substance: "generic",
        themes: ["calidad"],
        signals: [],
        sentiment: "positive",
        confidence: 0.9,
      },
      {
        token: "t2",
        substance: "specific",
        themes: ["a", "b", "c"],
        signals: ["workload", "attrition"],
        sentiment: "negative",
        confidence: 1,
      },
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.model).toBe(DEFAULT_ANALYSIS_MODEL);
    expect(params.output_config?.format).toMatchObject({ type: "json_schema" });
  });

  it("sends the question, who writes about whom and the resolved yes/no; asks for the new fields", async () => {
    const create = vi
      .fn<MessagesClient["create"]>()
      .mockResolvedValue(reply([label("t1"), label("t2")]));
    const p = new AnthropicProvider({ create });
    expect(p.promptVersion).toBe(ANTHROPIC_PROMPT_VERSION);
    expect(ANTHROPIC_PROMPT_VERSION).toBe("anthropic-v3");
    const impact = {
      es: '¿Contribuyo con iniciativas de "Impacto social"? ¿Cómo?',
      en: 'Do I contribute with initiatives related to "Social impact"? How?',
    };
    await p.analyze([
      item("t1", "Comunica bien", { relationship: "manager" }),
      item("t2", "con el voluntariado", {
        rubric: "yes_no_detail",
        dimension: "custom_x",
        question: impact,
        yesNo: "yes",
      }),
    ]);
    const params = create.mock.calls[0][0];
    const sent = JSON.parse(String(params.messages[0].content)) as {
      items: Record<string, unknown>[];
    };
    expect(sent.items).toEqual([
      {
        token: "t1",
        question: { es: "¿Qué hago bien?", en: "What do I do well?" },
        relationship: "manager",
        rubric: "strengths",
        text: "Comunica bien",
      },
      {
        token: "t2",
        question: impact,
        relationship: "self",
        rubric: "yes_no_detail",
        yes_no: "yes",
        text: "con el voluntariado",
      },
    ]);
    const format = params.output_config?.format as unknown as {
      schema: {
        properties: {
          results: {
            items: {
              required: string[];
              properties: {
                sentiment: { enum: string[] };
                substance: { enum: string[] };
                signals: { items: { enum: string[] } };
              };
            };
          };
        };
      };
    };
    const items = format.schema.properties.results.items;
    expect(items.required).toEqual(
      expect.arrayContaining(["substance", "themes", "signals", "sentiment"]),
    );
    expect(items.properties.substance.enum).toEqual([
      "none",
      "generic",
      "specific",
    ]);
    expect(items.properties.signals.items.enum).toEqual([
      "workload",
      "attrition",
      "conflict",
      "recognition",
      "stagnation",
      "company_request",
      "role_fit",
    ]);
    expect(items.properties.sentiment.enum).toEqual([
      "positive",
      "constructive",
      "neutral",
      "mixed",
      "negative",
    ]);
    const system = String(params.system);
    for (const word of [
      ...INITIAL_THEMES,
      ...COMPETENCY_THEMES,
      ...IMPACT_THEMES,
      "strengths",
      "improvement",
      "yes_no_detail",
    ]) {
      expect(system).toContain(word);
    }
  });

  it("fails on a missing token, garbage, an unknown signal or a refusal, without content in the error", async () => {
    const bad = [
      reply([]),
      reply([label("t", { signals: ["gossip"] })]),
      { stop_reason: "end_turn", content: [{ type: "text", text: "nope" }] },
      { stop_reason: "refusal", content: [] },
    ];
    for (const r of bad) {
      const p = new AnthropicProvider({ create: vi.fn().mockResolvedValue(r) });
      await expect(p.analyze([item("t", "SECRET TEXT")])).rejects.toThrow(
        /provider_failed/,
      );
      await expect(p.analyze([item("t", "SECRET TEXT")])).rejects.not.toThrow(
        /SECRET/,
      );
    }
  });
});
