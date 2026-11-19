import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { sentiments, signals, substances } from "./constants";
import { AnalysisError } from "./errors";
import { MockProvider } from "./mock-provider";
import { IMPACT_THEMES, THEMES } from "./themes";
import type {
  AnalysisInput,
  AnalysisOutput,
  AnalysisProvider,
} from "./provider";

/** Bump when the prompt or the output schema changes: it keys the cache. */
export const ANTHROPIC_PROMPT_VERSION = "anthropic-v3";
export const DEFAULT_ANALYSIS_MODEL = "claude-opus-5-5";
export const DEFAULT_BATCH_SIZE = 20;

const SYSTEM = `You read the free-text answers of employee performance reviews (Spanish or English) so that People (HR) learns what is useful from them.
Each item has: the question as asked ("question", es/en), who writes about whom ("relationship": "self" = the employee about themself, "manager" = the manager about their report), the rubric of the question, for a yes/no question the yes/no already given ("yes_no": "yes" or "no"; the text is then only the "how" after it), and the text.

For each item return:
- substance: does the text answer what was asked?
  "none" (nothing: "n/a", "-", a non-answer, or only praise where an improvement was asked),
  "generic" (an answer, but vague: no behaviour, situation, result or action you could point at),
  "specific" (a concrete behaviour, situation, result or action).
- themes: 0 to 3 keys saying what it is about. Use this vocabulary: ${THEMES.join(", ")}. Use another short lowercase Spanish noun without accents only when none fits.
- signals: 0 or more of ${signals.join(", ")}: what People has to attend to, whatever the question. workload = too much work, overtime, exhaustion; attrition = thinking of leaving; conflict = friction with someone; recognition = feeling unrecognized or undervalued; stagnation = not growing or learning; company_request = asks the company for something; role_fit = the role or project does not fit. Only when the text says it; never infer it from the question.
- sentiment, the tone, a secondary reading: exactly one of
  "positive" (praise, satisfaction),
  "constructive" (actionable suggestions to improve, neutral or balanced tone),
  "neutral" (factual or non-committal),
  "mixed" (clearly both praise and criticism),
  "negative" (criticism, problems, frustration).
  Judge the text, not the question: an improvement answer is not negative because it was asked for, and a strength is not positive by default.
- confidence: 0..1, how sure you are of this reading.

Rubrics:
- "strengths": themes = the strength (a competency or one of People's themes).
- "improvement": themes = the area to improve; only praise is substance "none".
- "yes_no_detail": the "how" of a yes/no question. When the question is about social or environmental impact initiatives, themes are initiative types: ${IMPACT_THEMES.join(", ")}.
- "open": any other free text.

Names, emails and employee numbers were replaced by tokens like [P1], [E1], [N1]; never guess who they are and never put tokens in themes.
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
          substance: { type: "string", enum: [...substances] },
          themes: { type: "array", items: { type: "string" } },
          signals: {
            type: "array",
            items: { type: "string", enum: [...signals] },
          },
          sentiment: { type: "string", enum: [...sentiments] },
          confidence: { type: "number" },
        },
        required: [
          "token",
          "substance",
          "themes",
          "signals",
          "sentiment",
          "confidence",
        ],
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
      substance: z.enum(substances),
      themes: z.array(z.string()),
      signals: z.array(z.enum(signals)),
      sentiment: z.enum(sentiments),
      confidence: z.number(),
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
              items: batch.map((i) => ({
                token: i.token,
                question: i.question,
                relationship: i.relationship,
                rubric: i.rubric,
                ...(i.yesNo ? { yes_no: i.yesNo } : {}),
                text: i.text,
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
        substance: r.substance,
        themes: r.themes.slice(0, 3),
        signals: [...new Set(r.signals)],
        sentiment: r.sentiment,
        confidence: Math.min(1, Math.max(0, r.confidence)),
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
