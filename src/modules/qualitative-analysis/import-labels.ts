import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { analysisRun } from "@/db/schema/qualitative";
import type { LocalizedText } from "@/db/schema/rating-scales";
import { parseCsv } from "@/fixtures/serialize/csv";
import { IMPORT_PROVIDER, parseSentiment } from "./constants";
import { analysisTextSql, analyzableSql } from "./analysis-text";
import { dimensionOf, fold } from "./dimension";
import { AnalysisError } from "./errors";
import {
  finishRun,
  normalizeTheme,
  seedInitialThemes,
  storeLabels,
  type LabelRow,
} from "./service";
import type { UnmatchedReason, UnmatchedRow } from "./import-labels-types";
import { textHash } from "./text-hash";
import { getSetting } from "@/modules/settings/service";

export {
  unmatchedReasons,
  type UnmatchedReason,
  type UnmatchedRow,
} from "./import-labels-types";

export const IMPORT_PROMPT_VERSION = "import-v1";

/** One CSV row (see docs/qualitative-labels.md); headers lowercased. */
export type LabelImportRow = Record<string, string | undefined>;

export type ImportLabelsResult = {
  runId: string;
  total: number;
  matched: number;
  unmatched: UnmatchedRow[];
};

/** Rows of a label CSV, keyed by lowercased header. */
export function parseLabelCsv(text: string): LabelImportRow[] {
  const [header, ...rows] = parseCsv(
    text.replace(/^﻿/, "").replace(/\r\n/g, "\n"),
  );
  if (!header) throw new AnalysisError("invalid_csv");
  const keys = header.map((h) => h.trim().toLowerCase());
  if (!keys.includes("sentiment") || !keys.includes("review_cycle")) {
    throw new AnalysisError("invalid_csv", [
      { path: "header", message: "needs review_cycle and sentiment" },
    ]);
  }
  return rows
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]?.trim()])));
}

type Candidate = {
  answer_id: string;
  text: string;
  prompt: LocalizedText;
  dimension: string | null;
  person_id: string;
  person_name: string;
  bamboo_id: string | null;
  cycle_name: string;
};

/**
 * Imports labels made elsewhere (spreadsheet, earlier tool) as provider
 * `import`. Each row is matched to an answer about that person in that cycle
 * by normalized text hash, else by dimension when exactly one answer fits
 * (closed-question answers too, by the label of the chosen option). The
 * sentiment may be spelled in Spanish or English (Positivo, Mixto...).
 * Rows that do not match are returned (and counted in the run), never guessed.
 */
export async function importLabels(
  db: DbOrTx,
  input: { csvPath: string } | { csv: string } | { rows: LabelImportRow[] },
  opts: { actorPersonId?: string | null; includeClosed?: boolean } = {},
): Promise<ImportLabelsResult> {
  const includeClosed =
    opts.includeClosed ?? (await getSetting(db, "analysis.includeClosed"));
  const rows =
    "rows" in input
      ? input.rows
      : parseLabelCsv(
          "csv" in input ? input.csv : await readFile(input.csvPath, "utf8"),
        );
  const [run] = await db
    .insert(analysisRun)
    .values({
      provider: IMPORT_PROVIDER,
      promptVersion: IMPORT_PROMPT_VERSION,
      triggeredBy: opts.actorPersonId ?? null,
    })
    .returning({ id: analysisRun.id });

  const candidates = await db.execute<Candidate>(sql`
    select a.id as answer_id, ${analysisTextSql()} as text, q.prompt, q.dimension,
           p.id as person_id, p.display_name as person_name,
           (select si.value from source_identity si where si.person_id = p.id
             and si.kind = 'bamboo_id' order by si.valid_from desc limit 1) as bamboo_id,
           c.name as cycle_name
    from answer a
    join review_request r on r.id = a.request_id
      and r.deleted_at is null and r.status = 'submitted'
    join cycle_participant cp on cp.id = r.participant_id and cp.removed_at is null
    join person p on p.id = cp.reviewee_person_id
    join review_cycle c on c.id = r.cycle_id
    join question_revision q on q.id = a.question_revision_id
    where ${analyzableSql(includeClosed)}`);
  const enriched = candidates.map((c) => ({
    ...c,
    hash: textHash(c.text),
    dimension: dimensionOf(c),
    name: fold(c.person_name).trim(),
    cycle: fold(c.cycle_name).trim(),
  }));

  const unmatched: UnmatchedRow[] = [];
  const labels: LabelRow[] = [];
  let matched = 0;
  for (const [i, row] of rows.entries()) {
    const employee = row.employee_name || row.bamboo_id || null;
    const cycleName = row.review_cycle || null;
    const miss = (reason: UnmatchedReason) =>
      unmatched.push({ line: i + 1, employee, cycle: cycleName, reason });
    const text = row.text;
    const hash = row.text_hash?.toLowerCase() || (text ? textHash(text) : null);
    if (
      !employee ||
      !cycleName ||
      !row.sentiment ||
      (!hash && !row.dimension && !row.question)
    ) {
      miss("missing_fields");
      continue;
    }
    const sentiment = parseSentiment(row.sentiment);
    if (!sentiment) {
      miss("invalid_sentiment");
      continue;
    }
    const ofPerson = enriched.filter((c) =>
      row.bamboo_id
        ? c.bamboo_id === row.bamboo_id
        : c.name === fold(employee).trim(),
    );
    if (ofPerson.length === 0) {
      miss("unknown_person");
      continue;
    }
    const inCycle = ofPerson.filter((c) => c.cycle === fold(cycleName).trim());
    if (inCycle.length === 0) {
      miss("unknown_cycle");
      continue;
    }
    let hits = hash ? inCycle.filter((c) => c.hash === hash) : [];
    if (hits.length === 0) {
      const dimension =
        row.dimension ||
        (row.question
          ? dimensionOf({ prompt: { es: row.question, en: row.question } })
          : null);
      hits = dimension ? inCycle.filter((c) => c.dimension === dimension) : [];
      if (hits.length > 1) {
        miss("ambiguous");
        continue;
      }
    }
    if (hits.length === 0) {
      miss("no_match");
      continue;
    }
    const confidence = row.confidence ? Number(row.confidence) : null;
    for (const hit of hits) {
      labels.push({
        answerId: hit.answer_id,
        provider: IMPORT_PROVIDER,
        promptVersion: IMPORT_PROMPT_VERSION,
        dimension: hit.dimension,
        sentiment,
        confidence:
          confidence !== null && Number.isFinite(confidence)
            ? Math.min(1, Math.max(0, confidence))
            : null,
        themes: [
          ...new Set(
            (row.themes ?? "").split(";").map(normalizeTheme).filter(Boolean),
          ),
        ],
        textHash: hit.hash,
        runId: run.id,
      });
    }
    matched++;
  }
  await storeLabels(db, labels);
  await seedInitialThemes(
    db,
    labels.map((l) => l.dimension),
  );
  await finishRun(
    db,
    run.id,
    { total: rows.length, analyzed: matched, cached: 0 },
    null,
  );
  return { runId: run.id, total: rows.length, matched, unmatched };
}
