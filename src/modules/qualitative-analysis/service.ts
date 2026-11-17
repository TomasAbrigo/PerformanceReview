import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { LocalizedText } from "@/db/schema/rating-scales";
import {
  analysisRun,
  qualitativeAnalysis,
  theme,
} from "@/db/schema/qualitative";
import { isUuid } from "@/lib/uuid";
import { DomainError } from "@/lib/domain-error";
import { dimensionOf, fold } from "./dimension";
import { AnalysisError } from "./errors";
import type { AnalysisInput, AnalysisProvider } from "./provider";
import {
  depseudonymize,
  pseudonymize,
  type PseudonymMap,
  type PseudonymSources,
} from "./pseudonymize";
import { textHash } from "./text-hash";

const DEFAULT_BATCH = 50;

/** A submitted open-text answer, with what the cache needs to know. */
type TextAnswer = {
  answer_id: string;
  text: string;
  prompt: LocalizedText;
  cached_hash: string | null;
  corrected: boolean;
};

/** Submitted, non-empty open-text answers (optionally of one cycle). */
async function textAnswers(
  db: DbOrTx,
  cycleId: string | undefined,
  provider: string,
  promptVersion: string,
): Promise<TextAnswer[]> {
  return db.execute<TextAnswer>(sql`
    select a.id as answer_id, a.text_value as text, q.prompt,
           qa.text_hash as cached_hash,
           exists (select 1 from analysis_correction c where c.answer_id = a.id) as corrected
    from answer a
    join review_request r on r.id = a.request_id
    join question_revision q on q.id = a.question_revision_id
    left join qualitative_analysis qa on qa.answer_id = a.id
      and qa.provider = ${provider} and qa.prompt_version = ${promptVersion}
    where q.kind = 'text' and a.text_value is not null and btrim(a.text_value) <> ''
      and r.deleted_at is null and r.status = 'submitted'
      ${cycleId ? sql`and r.cycle_id = ${cycleId}::uuid` : sql``}
    order by a.id`);
}

/** Names, emails and employee numbers of every person: what must not leave. */
export async function pseudonymSources(db: DbOrTx): Promise<PseudonymSources> {
  const people = await db.execute<{ name: string; email: string | null }>(
    sql`select display_name as name, work_email as email from person`,
  );
  const numbers = await db.execute<{ value: string }>(
    sql`select distinct value from source_identity where kind = 'employee_number'`,
  );
  return {
    knownNames: people.map((p) => p.name),
    emails: people.flatMap((p) => (p.email ? [p.email] : [])),
    employeeNumbers: numbers.map((n) => n.value),
  };
}

/** Normalized theme key: folded, single spaces, no tokens. */
export const normalizeTheme = (name: string) =>
  fold(name)
    .replace(/\[[pen]\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export type RunAnalysisResult = {
  runId: string;
  total: number;
  analyzed: number;
  cached: number;
  corrected: number;
};

/**
 * Labels the open-text answers with `provider`. Skips answers already labeled
 * by the same provider + prompt version with the same text (cache) and those
 * a person corrected (never overwritten). Texts are pseudonymized before they
 * reach the provider. The analysis_run row keeps counts, never content.
 */
export async function runAnalysis(
  db: DbOrTx,
  opts: {
    cycleId?: string;
    provider: AnalysisProvider;
    actorPersonId?: string | null;
    signal?: AbortSignal;
  },
): Promise<RunAnalysisResult> {
  const { provider } = opts;
  if (opts.cycleId !== undefined && !isUuid(opts.cycleId)) {
    throw new AnalysisError("not_found");
  }
  const [run] = await db
    .insert(analysisRun)
    .values({
      provider: provider.name,
      model: provider.model ?? null,
      promptVersion: provider.promptVersion,
      cycleId: opts.cycleId ?? null,
      triggeredBy: opts.actorPersonId ?? null,
    })
    .returning({ id: analysisRun.id });
  const counts = { total: 0, analyzed: 0, cached: 0, corrected: 0 };
  try {
    const rows = await textAnswers(
      db,
      opts.cycleId,
      provider.name,
      provider.promptVersion,
    );
    counts.total = rows.length;
    const todo: (TextAnswer & { hash: string; dimension: string })[] = [];
    for (const row of rows) {
      const hash = textHash(row.text);
      if (row.corrected) counts.corrected++;
      else if (row.cached_hash === hash) counts.cached++;
      else todo.push({ ...row, hash, dimension: dimensionOf(row) });
    }
    if (todo.length > 0) {
      const { texts, map } = pseudonymize(
        todo.map((t) => t.text),
        await pseudonymSources(db),
      );
      const size = provider.batchSize ?? DEFAULT_BATCH;
      for (let i = 0; i < todo.length; i += size) {
        opts.signal?.throwIfAborted();
        const slice = todo.slice(i, i + size);
        const inputs: AnalysisInput[] = slice.map((t, j) => ({
          token: `t${i + j}`,
          dimension: t.dimension,
          text: texts[i + j],
        }));
        const outputs = await provider.analyze(inputs, opts.signal);
        const byToken = new Map(outputs.map((o) => [o.token, o]));
        for (const [j, t] of slice.entries()) {
          const out = byToken.get(inputs[j].token);
          if (!out) throw new AnalysisError("provider_failed");
          await storeLabel(db, {
            answerId: t.answer_id,
            provider: provider.name,
            promptVersion: provider.promptVersion,
            dimension: t.dimension,
            sentiment: out.sentiment,
            confidence: out.confidence,
            themes: cleanThemes(out.themes, map),
            textHash: t.hash,
            runId: run.id,
          });
          counts.analyzed++;
        }
      }
    }
    await finishRun(db, run.id, counts, null);
    return { runId: run.id, ...counts };
  } catch (error) {
    const code =
      error instanceof DomainError
        ? error.code
        : error instanceof Error
          ? error.name
          : "error";
    await finishRun(db, run.id, counts, code);
    throw error;
  }
}

/** Restores tokens, then keeps themes without any person data, deduped. */
function cleanThemes(themes: string[], map: PseudonymMap): string[] {
  const out = new Map<string, string>();
  for (const raw of themes) {
    // A theme that needed a token restored names someone: drop it.
    if (depseudonymize(raw, map) !== raw) continue;
    const key = normalizeTheme(raw);
    if (key && !out.has(key)) out.set(key, key);
  }
  return [...out.values()].slice(0, 3);
}

export type LabelRow = typeof qualitativeAnalysis.$inferInsert;

/** Upserts the label of an answer for its provider + prompt version, and its themes. */
export async function storeLabel(db: DbOrTx, label: LabelRow) {
  await db
    .insert(qualitativeAnalysis)
    .values(label)
    .onConflictDoUpdate({
      target: [
        qualitativeAnalysis.answerId,
        qualitativeAnalysis.provider,
        qualitativeAnalysis.promptVersion,
      ],
      set: {
        dimension: label.dimension,
        sentiment: label.sentiment,
        confidence: label.confidence,
        themes: label.themes,
        textHash: label.textHash,
        runId: label.runId,
        createdAt: sql`now()`,
      },
    });
  await upsertThemes(db, label.dimension, label.themes ?? []);
}

export async function upsertThemes(
  db: DbOrTx,
  dimension: string,
  themes: string[],
) {
  if (themes.length === 0) return;
  await db
    .insert(theme)
    .values(
      themes.map((name) => ({
        dimension,
        name,
        normalizedName: normalizeTheme(name),
      })),
    )
    .onConflictDoNothing();
}

export async function finishRun(
  db: DbOrTx,
  runId: string,
  counts: { total: number; analyzed: number; cached: number },
  error: string | null,
) {
  await db
    .update(analysisRun)
    .set({
      status: error ? "error" : "succeeded",
      textsTotal: counts.total,
      textsAnalyzed: counts.analyzed,
      textsCached: counts.cached,
      finishedAt: sql`now()`,
      error,
    })
    .where(eq(analysisRun.id, runId));
}
