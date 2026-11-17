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
import { INITIAL_THEMES } from "./themes";

const reply = (results: unknown) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify({ results }) }],
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
  it("sends one structured-output request per batch and maps results by token", async () => {
    const create = vi.fn<MessagesClient["create"]>().mockResolvedValue(
      reply([
        {
          token: "t2",
          sentiment: "negative",
          confidence: 1.4,
          themes: ["a", "b", "c", "d"],
        },
        {
          token: "t1",
          sentiment: "positive",
          confidence: 0.9,
          themes: ["calidad"],
        },
      ]),
    );
    const p = new AnthropicProvider({ create });
    const out = await p.analyze([
      { token: "t1", dimension: "strengths", text: "[P1] es genial" },
      { token: "t2", dimension: "improvement", text: "llega tarde" },
    ]);
    expect(out).toEqual([
      {
        token: "t1",
        sentiment: "positive",
        confidence: 0.9,
        themes: ["calidad"],
      },
      {
        token: "t2",
        sentiment: "negative",
        confidence: 1,
        themes: ["a", "b", "c"],
      },
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.model).toBe(DEFAULT_ANALYSIS_MODEL);
    expect(params.output_config?.format).toMatchObject({ type: "json_schema" });
  });
  it("asks for the five sentiments, the initial themes and flags closed answers", async () => {
    const create = vi.fn<MessagesClient["create"]>().mockResolvedValue(
      reply([
        { token: "t1", sentiment: "mixed", confidence: 0.7, themes: [] },
        { token: "t2", sentiment: "neutral", confidence: 0.6, themes: [] },
      ]),
    );
    const p = new AnthropicProvider({ create });
    expect(p.promptVersion).toBe(ANTHROPIC_PROMPT_VERSION);
    expect(ANTHROPIC_PROMPT_VERSION).toBe("anthropic-v2");
    const out = await p.analyze([
      { token: "t1", dimension: "strengths", text: "bien pero tarde" },
      { token: "t2", dimension: "valued", text: "Somewhat", closed: true },
    ]);
    expect(out.map((r) => r.sentiment)).toEqual(["mixed", "neutral"]);
    const params = create.mock.calls[0][0];
    const format = params.output_config?.format as unknown as {
      schema: {
        properties: {
          results: {
            items: { properties: { sentiment: { enum: string[] } } };
          };
        };
      };
    };
    expect(
      format.schema.properties.results.items.properties.sentiment.enum,
    ).toEqual(["positive", "constructive", "neutral", "mixed", "negative"]);
    const system = String(params.system);
    for (const word of ["neutral", "mixed", ...INITIAL_THEMES]) {
      expect(system).toContain(word);
    }
    const sent = JSON.parse(String(params.messages[0].content)) as {
      items: { token: string; closed?: boolean }[];
    };
    expect(sent.items).toEqual([
      expect.objectContaining({ token: "t1" }),
      expect.objectContaining({ token: "t2", closed: true }),
    ]);
    expect(sent.items[0]).not.toHaveProperty("closed");
  });
  it("fails on a missing token, garbage or a refusal, without content in the error", async () => {
    const bad = [
      reply([]),
      { stop_reason: "end_turn", content: [{ type: "text", text: "nope" }] },
      { stop_reason: "refusal", content: [] },
    ];
    for (const r of bad) {
      const p = new AnthropicProvider({ create: vi.fn().mockResolvedValue(r) });
      await expect(
        p.analyze([{ token: "t", dimension: "x", text: "SECRET TEXT" }]),
      ).rejects.toThrow(/provider_failed/);
      await expect(
        p.analyze([{ token: "t", dimension: "x", text: "SECRET TEXT" }]),
      ).rejects.not.toThrow(/SECRET/);
    }
  });
});
