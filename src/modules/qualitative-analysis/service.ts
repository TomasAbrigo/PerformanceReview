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
import {
  analysisTextSql,
  analyzableSql,
  yesNoAnswerSql,
} from "./analysis-text";
import type { YesNo } from "./constants";
import { dimensionOf, fold } from "./dimension";
import { AnalysisError } from "./errors";
import type {
  AnalysisInput,
  AnalysisProvider,
  Rubric,
  Writer,
} from "./provider";
import {
  depseudonymize,
  pseudonymize,
  type PseudonymMap,
  type PseudonymSources,
} from "./pseudonymize";
import { canonicalTheme, initialThemeRows } from "./themes";
import { textHash } from "./text-hash";

const DEFAULT_BATCH = 50;

/** A submitted open-text answer, with what the cache needs to know. */
type TextAnswer = {
  answer_id: string;
  text: string;
  prompt: LocalizedText;
  dimension: string | null;
  /** The question is a yes/no one (question_revision.yes_no). */
  yes_no_question: boolean;
  /** Its yes/no answer, when it is a yes/no question. */
  yes_no: YesNo | null;
  relationship: Writer;
  cached_hash: string | null;
  /** The cached label was made from exactly this text. */
  fresh: boolean;
  corrected: boolean;
};

/**
 * Submitted answers with free text to read (optionally of one cycle): see
 * analysisTextSql (a chosen option is never read; of a yes/no question only
 * the "how").
 */
async function textAnswers(
  db: DbOrTx,
  cycleId: string | undefined,
  provider: string,
  promptVersion: string,
): Promise<TextAnswer[]> {
  return db.execute<TextAnswer>(sql`
    select a.id as answer_id, ${analysisTextSql()} as text, q.prompt, q.dimension,
           q.yes_no as yes_no_question, ${yesNoAnswerSql()} as yes_no,
           r.relationship::text as relationship, qa.text_hash as cached_hash,
           coalesce(qa.source_md5 = md5(${analysisTextSql()}), false) as fresh,
           exists (select 1 from analysis_correction c where c.answer_id = a.id) as corrected
    from answer a
    join review_request r on r.id = a.request_id
    join cycle_participant cp on cp.id = r.participant_id and cp.removed_at is null
    join question_revision q on q.id = a.question_revision_id
    left join qualitative_analysis qa on qa.answer_id = a.id
      and qa.provider = ${provider} and qa.prompt_version = ${promptVersion}
    where ${analyzableSql()}
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

/** The rubric a text is read with, from its question (provider.ts). */
export function rubricOf(q: { dimension: string; yesNo: boolean }): Rubric {
  if (q.yesNo) return "yes_no_detail";
  if (q.dimension === "strengths") return "strengths";
  if (q.dimension === "improvement") return "improvement";
  return "open";
}

export type RunAnalysisResult = {
  runId: string;
  total: number;
  analyzed: number;
  cached: number;
  corrected: number;
};

/**
 * Reads the free-text answers with `provider` (#128: substance, themes,
 * signals, sentiment, confidence), with the question, who writes about whom
 * and the resolved yes/no. Skips answers already labeled
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
    await seedInitialThemes(db, rows.map(dimensionOf));
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
          rubric: rubricOf({
            dimension: t.dimension,
            yesNo: t.yes_no_question,
          }),
          question: t.prompt,
          relationship: t.relationship,
          yesNo: t.yes_no,
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
            substance: out.substance,
            signals: out.signals,
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
    const key = canonicalTheme(normalizeTheme(raw));
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
        sourceMd5: sql`(select md5(${analysisTextSql()}) from answer a
          join question_revision q on q.id = a.question_revision_id
          where a.id = ${l.answerId}::uuid)`,
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
        substance: sql`excluded.substance`,
        signals: sql`excluded.signals`,
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

/** Catalogs the initial theme vocabulary under each of `dimensions`. */
export async function seedInitialThemes(db: DbOrTx, dimensions: string[]) {
  await upsertThemeRows(db, initialThemeRows(dimensions));
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
