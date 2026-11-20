import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { adminAuditLog } from "@/db/schema/admin-audit";
import { analysisCorrection } from "@/db/schema/qualitative";
import { parse } from "@/lib/domain-error";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { sentiments, signals, substances } from "./constants";
import { analysisTextSql } from "./analysis-text";
import { effectiveCte } from "./effective";
import { AnalysisError } from "./errors";
import { normalizeTheme, upsertThemes } from "./service";
import { canonicalTheme } from "./themes";

export const correctionSchema = z.object({
  sentiment: z.enum(sentiments),
  themes: z.array(z.string().trim().min(1).max(60)).max(5),
  /** Absent: the label's substance stays. */
  substance: z.enum(substances).optional(),
  /** Absent: the label's signals stay. */
  signals: z.array(z.enum(signals)).max(signals.length).optional(),
  reason: z.string().trim().max(500).optional(),
});
export type CorrectionInput = z.input<typeof correctionSchema>;

/**
 * A person (HR) corrects the label of an answer: appended to
 * analysis_correction (never updated) and to the admin audit log. Later runs
 * never overwrite it.
 */
export async function correctLabel(
  db: DbOrTx,
  actor: ActorContext,
  answerId: string,
  input: CorrectionInput,
): Promise<{ id: string }> {
  if (actor.role !== "hr") throw new AnalysisError("forbidden");
  if (!isUuid(answerId)) throw new AnalysisError("not_found");
  const data = parse(correctionSchema, input, AnalysisError);
  const [target] = await db.execute<{
    cycle_id: string;
    dimension: string | null;
    sentiment: (typeof sentiments)[number] | null;
    themes: string[] | null;
    substance: (typeof substances)[number] | null;
    signals: string[] | null;
    source_md5: string | null;
  }>(sql`
    with ${effectiveCte()}
    select r.cycle_id, eff.dimension, eff.sentiment, eff.themes,
           eff.substance, eff.signals,
           md5(${analysisTextSql("a", "q")}) as source_md5
    from answer a
    join review_request r on r.id = a.request_id
    join question_revision q on q.id = a.question_revision_id
    left join eff on eff.answer_id = a.id
    where a.id = ${answerId}::uuid`);
  if (!target) throw new AnalysisError("not_found");
  // Only a labeled answer (free text) can be corrected:
  // it is what the readers show.
  if (!target.sentiment) throw new AnalysisError("not_labeled");
  const themes = [
    ...new Set(
      data.themes.map((t) => canonicalTheme(normalizeTheme(t))).filter(Boolean),
    ),
  ];
  const newSignals = data.signals ? [...new Set(data.signals)] : null;
  const [row] = await db
    .insert(analysisCorrection)
    .values({
      answerId,
      previousSentiment: target.sentiment,
      newSentiment: data.sentiment,
      previousThemes: target.themes,
      newThemes: themes,
      previousSubstance: target.substance,
      newSubstance: data.substance ?? null,
      previousSignals: target.signals,
      newSignals,
      actorPersonId: actor.personId,
      reason: data.reason || null,
      // The text it was made on: a re-import that changes it makes it stale.
      sourceMd5: target.source_md5,
    })
    .returning({ id: analysisCorrection.id });
  await db.insert(adminAuditLog).values({
    actorPersonId: actor.personId,
    action: "qualitative_label_corrected",
    targetType: "answer",
    targetId: answerId,
    cycleId: target.cycle_id,
    before: {
      sentiment: target.sentiment,
      themes: target.themes,
      substance: target.substance,
      signals: target.signals,
    },
    after: {
      sentiment: data.sentiment,
      themes,
      substance: data.substance ?? target.substance,
      signals: newSignals ?? target.signals,
    },
    note: data.reason || null,
  });
  if (target.dimension) await upsertThemes(db, target.dimension, themes);
  return row;
}
