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
  dimension: string | null;
  cached_hash: string | null;
  /** The cached label was made from exactly this text. */
  fresh: boolean;
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
    select a.id as answer_id, a.text_value as text, q.prompt, q.dimension,
           qa.text_hash as cached_hash,
           coalesce(qa.source_md5 = md5(a.text_value), false) as fresh,
           exists (select 1 from analysis_correction c where c.answer_id = a.id) as corrected
    from answer a
    join review_request r on r.id = a.request_id
    join cycle_participant cp on cp.id = r.participant_id and cp.removed_at is null
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
      else if (row.cached_hash === hash && row.fresh) counts.cached++;
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
        const labels = slice.map((t, j) => {
          const out = byToken.get(inputs[j].token);
          if (!out) throw new AnalysisError("provider_failed");
          return {
            answerId: t.answer_id,
            provider: provider.name,
            promptVersion: provider.promptVersion,
            dimension: t.dimension,
            sentiment: out.sentiment,
            confidence: out.confidence,
            themes: cleanThemes(out.themes, map),
            textHash: t.hash,
            runId: run.id,
          };
        });
        await storeLabels(db, labels);
        counts.analyzed += labels.length;
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

export type LabelRow = Omit<
  typeof qualitativeAnalysis.$inferInsert,
  "sourceMd5" | "id" | "createdAt"
>;

/**
 * Upserts labels (one statement) for their provider + prompt version, with
 * the md5 of the answer text they were made from, and their themes.
 */
export async function storeLabels(db: DbOrTx, labels: LabelRow[]) {
  if (labels.length === 0) return;
  // Last one wins when a batch labels the same answer twice.
  const unique = [...new Map(labels.map((l) => [l.answerId, l])).values()];
  await db
    .insert(qualitativeAnalysis)
    .values(
      unique.map((l) => ({
        ...l,
        sourceMd5: sql`(select md5(text_value) from answer where id = ${l.answerId}::uuid)`,
      })),
    )
    .onConflictDoUpdate({
      target: [
        qualitativeAnalysis.answerId,
        qualitativeAnalysis.provider,
        qualitativeAnalysis.promptVersion,
      ],
      set: {
        dimension: sql`excluded.dimension`,
        sentiment: sql`excluded.sentiment`,
        confidence: sql`excluded.confidence`,
        themes: sql`excluded.themes`,
        textHash: sql`excluded.text_hash`,
        sourceMd5: sql`excluded.source_md5`,
        runId: sql`excluded.run_id`,
        createdAt: sql`now()`,
      },
    });
  const themes = new Map<string, { dimension: string; name: string }>();
  for (const l of unique) {
    for (const name of l.themes ?? []) {
      themes.set(`${l.dimension}\u0000${name}`, {
        dimension: l.dimension,
        name,
      });
    }
  }
  await upsertThemeRows(db, [...themes.values()]);
}

export async function upsertThemes(
  db: DbOrTx,
  dimension: string,
  themes: string[],
) {
  await upsertThemeRows(
    db,
    themes.map((name) => ({ dimension, name })),
  );
}

async function upsertThemeRows(
  db: DbOrTx,
  rows: { dimension: string; name: string }[],
) {
  if (rows.length === 0) return;
  await db
    .insert(theme)
    .values(rows.map((r) => ({ ...r, normalizedName: normalizeTheme(r.name) })))
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
