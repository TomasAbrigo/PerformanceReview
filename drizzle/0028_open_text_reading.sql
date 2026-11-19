CREATE TYPE "public"."analysis_substance" AS ENUM('none', 'generic', 'specific');--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "yes_no" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "question_revision" ADD COLUMN "yes_no" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_correction" ADD COLUMN "previous_substance" "analysis_substance";--> statement-breakpoint
ALTER TABLE "analysis_correction" ADD COLUMN "new_substance" "analysis_substance";--> statement-breakpoint
ALTER TABLE "analysis_correction" ADD COLUMN "previous_signals" text[];--> statement-breakpoint
ALTER TABLE "analysis_correction" ADD COLUMN "new_signals" text[];--> statement-breakpoint
ALTER TABLE "qualitative_analysis" ADD COLUMN "substance" "analysis_substance";--> statement-breakpoint
ALTER TABLE "qualitative_analysis" ADD COLUMN "signals" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- #128: the imported custom questions answered with a yes/no (90 % of 3+ non-empty answers start with Sí/Si/Yes/No) are yes/no questions (markYesNoQuestions).
WITH stats AS (
  SELECT q.id,
         count(*) FILTER (WHERE btrim(coalesce(a.text_value, '')) <> '') AS answered,
         count(*) FILTER (WHERE a.text_value ~ '^[[:space:]]*([sS][iIíÍ]|[yY][eE][sS]|[nN][oO])([^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ]|$)') AS yes_no
  FROM "question_revision" q
  LEFT JOIN "answer" a ON a.question_revision_id = q.id
  WHERE q.kind = 'text' AND q.question_id IS NULL AND q.dimension LIKE 'custom\_%'
  GROUP BY q.id
)
UPDATE "question_revision" q SET "yes_no" = true
FROM stats s
WHERE s.id = q.id AND s.answered >= 3 AND s.yes_no >= 0.9 * s.answered;--> statement-breakpoint
-- #128: closed options are never analysed any more; the setting is gone.
DELETE FROM "app_setting" WHERE "key" = 'analysis.includeClosed';
