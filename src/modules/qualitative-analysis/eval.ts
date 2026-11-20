import { parseArgs } from "node:util";
import type { BankEntry, BankQuestion } from "@/fixtures/company/text-bank";
import { TEXT_BANK } from "@/fixtures/company/text-bank";
import { DomainError } from "@/lib/domain-error";
import { UsageError } from "@/modules/ingest/cli";
import { parseYesNo } from "./analysis-text";
import { createProvider, type MessagesClient } from "./anthropic-provider";
import { analysisProviderNames } from "./constants";
import type {
  AnalysisInput,
  AnalysisOutput,
  AnalysisProvider,
  Rubric,
} from "./provider";

/**
 * `pnpm analysis:eval` (#129): how far a provider's reading agrees with the
 * hand-labelled bank of the fixtures (`TEXT_BANK`, #127), field by field.
 * The texts are synthetic, so they can reach any provider.
 */

/** How each bank question is asked (the Santex template's questions). */
const QUESTION: Record<
  BankQuestion,
  { dimension: string; rubric: Rubric; es: string; en: string }
> = {
  strengths: {
    dimension: "strengths",
    rubric: "strengths",
    es: "¿Qué cosas hago bien?",
    en: "What are some things I do well?",
  },
  improvement: {
    dimension: "improvement",
    rubric: "improvement",
    es: "¿Cómo podría mejorar?",
    en: "How could I improve?",
  },
  social_impact: {
    dimension: "custom_1",
    rubric: "yes_no_detail",
    es: "¿Contribuyo con iniciativas de «Impacto social»? ¿Cómo?",
    en: 'Do I contribute with initiatives related to "Social impact"? How?',
  },
  environmental_impact: {
    dimension: "custom_2",
    rubric: "yes_no_detail",
    es: "¿Contribuyo con iniciativas de «Impacto ambiental»? ¿Cómo?",
    en: 'Do I contribute with initiatives related to "Environmental impact"? How?',
  },
  best_work_other: {
    dimension: "best_work",
    rubric: "open",
    es: "¿Qué me ayudaría a hacer mi mejor trabajo? (Otro)",
    en: "What would help me do my best work? (Other)",
  },
};

/** The provider's input for a bank entry, as the analysis run builds it. */
export function evalInput(e: BankEntry, i: number): AnalysisInput | null {
  const q = QUESTION[e.question];
  const yesNo = q.rubric === "yes_no_detail" ? parseYesNo(e.text) : null;
  const text = yesNo ? yesNo.detail : e.text.trim() || null;
  // Nothing to read (a bare yes/no): the run never sends it.
  if (!text) return null;
  return {
    token: `t${i}`,
    dimension: q.dimension,
    rubric: q.rubric,
    question: { es: q.es, en: q.en },
    relationship: e.side,
    yesNo: yesNo?.answer ?? null,
    text,
  };
}

export type FieldScore = {
  /** Texts scored on the field. */
  n: number;
  /** 0-1. */
  value: number;
};

export type EvalReport = {
  provider: string;
  model: string | null;
  texts: number;
  substance: FieldScore;
  tone: FieldScore;
  yesNo: FieldScore;
  signalsPrecision: FieldScore;
  signalsRecall: FieldScore;
  /** Mean Jaccard overlap of the theme sets (both empty = 1). */
  themes: FieldScore;
};

const score = (hits: number, n: number): FieldScore => ({
  n,
  value: n ? hits / n : 0,
});

/** Scores `provider` against `bank`. */
export async function evaluateProvider(
  provider: AnalysisProvider,
  bank: readonly BankEntry[] = TEXT_BANK,
): Promise<EvalReport> {
  const inputs = bank.map(evalInput);
  const sent = inputs.filter((x): x is AnalysisInput => x !== null);
  const size = provider.batchSize ?? (sent.length || 1);
  const outputs = new Map<string, AnalysisOutput>();
  for (let i = 0; i < sent.length; i += size) {
    for (const o of await provider.analyze(sent.slice(i, i + size))) {
      outputs.set(o.token, o);
    }
  }
  let substance = 0;
  let tone = 0;
  let toneN = 0;
  let yesNo = 0;
  let yesNoN = 0;
  let sigTp = 0;
  let sigPred = 0;
  let sigGold = 0;
  let themes = 0;
  bank.forEach((e, i) => {
    const input = inputs[i];
    const out = input ? outputs.get(input.token) : undefined;
    // A text the run never reads has no substance, themes nor signals.
    const got = {
      substance: out?.substance ?? "none",
      themes: out?.themes ?? [],
      signals: out?.signals ?? [],
    };
    if (got.substance === e.expected.substance) substance += 1;
    if (out) {
      toneN += 1;
      if (out.sentiment === e.expected.tone) tone += 1;
    }
    if (e.expected.yesNo) {
      yesNoN += 1;
      if (parseYesNo(e.text).answer === e.expected.yesNo) yesNo += 1;
    }
    const gold = new Set(e.expected.signals);
    const pred = new Set<string>(got.signals);
    sigGold += gold.size;
    sigPred += pred.size;
    for (const s of pred) if (gold.has(s)) sigTp += 1;
    const a = new Set(e.expected.themes);
    const b = new Set(got.themes);
    const union = new Set([...a, ...b]).size;
    const inter = [...a].filter((x) => b.has(x)).length;
    themes += union ? inter / union : 1;
  });
  return {
    provider: provider.name,
    model: provider.model ?? null,
    texts: bank.length,
    substance: score(substance, bank.length),
    tone: score(tone, toneN),
    yesNo: score(yesNo, yesNoN),
    signalsPrecision: score(sigTp, sigPred),
    signalsRecall: score(sigTp, sigGold),
    themes: score(themes, bank.length),
  };
}

/** The report as a small table (one row per field). */
export function formatEvalReport(r: EvalReport): string {
  const rows: [string, FieldScore][] = [
    ["substance accuracy", r.substance],
    ["tone accuracy", r.tone],
    ["yes/no accuracy", r.yesNo],
    ["signals precision", r.signalsPrecision],
    ["signals recall", r.signalsRecall],
    ["themes overlap (Jaccard)", r.themes],
  ];
  const width = Math.max(...rows.map(([k]) => k.length));
  return [
    `analysis eval: provider ${r.provider}${r.model ? ` (${r.model})` : ""}, ${r.texts} texts of the fixture bank`,
    `${"field".padEnd(width)}  value     n`,
    ...rows.map(
      ([k, s]) =>
        `${k.padEnd(width)}  ${`${(s.value * 100).toFixed(1)} %`.padStart(7)}  ${String(s.n).padStart(4)}`,
    ),
  ].join("\n");
}

export const EVAL_USAGE = [
  "Usage: pnpm analysis:eval [--provider mock|anthropic]",
  "  Scores a provider against the hand-labelled text bank of the fixtures (no database).",
  "  anthropic needs ANTHROPIC_API_KEY (ANALYSIS_MODEL overrides the model).",
  "Exit code: 0 ok, 1 the evaluation failed, 2 bad arguments or configuration.",
].join("\n");

/** Runs `pnpm analysis:eval`; returns the exit code. */
export async function evalCli(
  argv: string[],
  deps: {
    env: Record<string, string | undefined>;
    stdout?: (line: string) => void;
    stderr?: (line: string) => void;
    client?: MessagesClient;
  },
): Promise<number> {
  const out = deps.stdout ?? console.log;
  const err = deps.stderr ?? console.error;
  let provider: AnalysisProvider;
  try {
    let values;
    try {
      ({ values } = parseArgs({
        args: argv,
        options: { provider: { type: "string" } },
      }));
    } catch (e) {
      throw new UsageError(e instanceof Error ? e.message : String(e));
    }
    if (
      values.provider !== undefined &&
      !(analysisProviderNames as readonly string[]).includes(values.provider)
    ) {
      throw new UsageError(
        `--provider must be mock or anthropic (got ${values.provider})`,
      );
    }
    provider = createProvider(deps.env, {
      override: values.provider,
      client: deps.client,
    });
  } catch (e) {
    if (e instanceof UsageError || e instanceof DomainError) {
      err(`${e.message}\n\n${EVAL_USAGE}`);
      return 2;
    }
    throw e;
  }
  try {
    out(formatEvalReport(await evaluateProvider(provider)));
    return 0;
  } catch (e) {
    err(
      `evaluation failed: ${e instanceof DomainError ? e.code : e instanceof Error ? e.name : "error"}`,
    );
    return 1;
  }
}
