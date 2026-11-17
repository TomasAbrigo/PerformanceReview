import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { sentiments } from "./constants";
import { AnalysisError } from "./errors";
import { MockProvider } from "./mock-provider";
import { INITIAL_THEMES } from "./themes";
import type {
  AnalysisInput,
  AnalysisOutput,
  AnalysisProvider,
} from "./provider";

/** Bump when the prompt or the output schema changes: it keys the cache. */
export const ANTHROPIC_PROMPT_VERSION = "anthropic-v2";
export const DEFAULT_ANALYSIS_MODEL = "claude-opus-5-5";
export const DEFAULT_BATCH_SIZE = 20;

const SYSTEM = `You label open-text comments, and the chosen options of closed questions, from employee performance reviews (Spanish or English).
For each item return:
- sentiment, exactly one of:
  "positive" (praise, strengths, satisfaction),
  "constructive" (actionable suggestions to improve, neutral or balanced tone),
  "neutral" (factual or non-committal, no clear praise, criticism or suggestion; also a closed-question option that expresses neither),
  "mixed" (clearly contains both praise and criticism),
  "negative" (criticism, problems, frustration).
- confidence: 0..1, how sure you are of the sentiment.
- themes: 0 to 3 short themes, lowercase Spanish nouns without accents. Prefer this vocabulary when a theme fits: ${INITIAL_THEMES.join(", ")}. Use another short noun only when none of them fits, and reuse the same words across items.
Names, emails and employee numbers were replaced by tokens like [P1], [E1], [N1]; never guess who they are and never put tokens in themes.
The item's dimension tells which question the comment answers. When an item has "closed": true, its text is the label of the option the person chose in a closed question (for example how well the company recognizes their value), not free text: judge what that answer says about the dimension.
Return exactly one result per input token.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          token: { type: "string" },
          sentiment: { type: "string", enum: [...sentiments] },
          confidence: { type: "number" },
          themes: { type: "array", items: { type: "string" } },
        },
        required: ["token", "sentiment", "confidence", "themes"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const;

const outputSchema = z.object({
  results: z.array(
    z.object({
      token: z.string(),
      sentiment: z.enum(sentiments),
      confidence: z.number(),
      themes: z.array(z.string()),
    }),
  ),
});

/** The slice of the SDK client the provider uses (injected in tests). */
export type MessagesClient = {
  create(
    params: Anthropic.Beta.MessageCreateParamsNonStreaming,
    options?: { signal?: AbortSignal },
  ): Promise<{
    stop_reason: string | null;
    content: { type: string; text?: string }[];
  }>;
};

/**
 * Claude via the Messages API, one request per batch with a JSON-schema
 * structured output. Never logs the texts; errors carry no content.
 */
export class AnthropicProvider implements AnalysisProvider {
  readonly name = "anthropic";
  readonly promptVersion = ANTHROPIC_PROMPT_VERSION;
  readonly model: string;
  readonly batchSize: number;

  constructor(
    private readonly client: MessagesClient,
    opts: { model?: string; batchSize?: number } = {},
  ) {
    this.model = opts.model || DEFAULT_ANALYSIS_MODEL;
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  async analyze(
    batch: AnalysisInput[],
    signal?: AbortSignal,
  ): Promise<AnalysisOutput[]> {
    if (batch.length === 0) return [];
    const response = await this.client.create(
      {
        model: this.model,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: OUTPUT_SCHEMA },
        },
        // On a safety decline, re-run on the fallback model the API picks.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              items: batch.map(({ token, dimension, text, closed }) => ({
                token,
                dimension,
                text,
                ...(closed ? { closed: true } : {}),
              })),
            }),
          },
        ],
      },
      { signal },
    );
    if (response.stop_reason === "refusal") {
      throw new AnalysisError("provider_failed", [
        { path: "stop_reason", message: "refusal" },
      ]);
    }
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    let parsed;
    try {
      parsed = outputSchema.parse(JSON.parse(text));
    } catch {
      throw new AnalysisError("provider_failed", [
        { path: "output", message: `unparseable (${response.stop_reason})` },
      ]);
    }
    const byToken = new Map(parsed.results.map((r) => [r.token, r]));
    return batch.map(({ token }) => {
      const r = byToken.get(token);
      if (!r) {
        throw new AnalysisError("provider_failed", [
          { path: "output", message: "missing token" },
        ]);
      }
      return {
        token,
        sentiment: r.sentiment,
        confidence: Math.min(1, Math.max(0, r.confidence)),
        themes: r.themes.slice(0, 3),
      };
    });
  }
}

type Env = Record<string, string | undefined>;

/**
 * The provider for this environment: ANALYSIS_PROVIDER=mock (default) or
 * anthropic (needs ANTHROPIC_API_KEY; ANALYSIS_MODEL overrides the model).
 * `override` (CLI --provider) wins over the env.
 */
export function createProvider(
  env: Env,
  { override, client }: { override?: string; client?: MessagesClient } = {},
): AnalysisProvider {
  const name = override ?? env.ANALYSIS_PROVIDER ?? "mock";
  if (name === "mock" || name === "") return new MockProvider();
  if (name !== "anthropic") {
    throw new AnalysisError("unknown_provider", [
      { path: "ANALYSIS_PROVIDER", message: `must be mock or anthropic` },
    ]);
  }
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AnalysisError("missing_api_key", [
      {
        path: "ANTHROPIC_API_KEY",
        message: "required when ANALYSIS_PROVIDER=anthropic",
      },
    ]);
  }
  const messages =
    client ??
    (() => {
      const sdk = new Anthropic({ apiKey });
      return {
        create: (params, options) => sdk.beta.messages.create(params, options),
      } satisfies MessagesClient;
    })();
  return new AnthropicProvider(messages, { model: env.ANALYSIS_MODEL });
}
