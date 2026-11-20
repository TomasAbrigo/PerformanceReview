ALTER TABLE "review_request" ALTER COLUMN "requested_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "engagement_monthly" ADD COLUMN "segment_from_file" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "history_import_row" ADD COLUMN "requests_updated" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "history_import_row" ADD COLUMN "requests_removed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "history_import_row" ADD COLUMN "answers_updated" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "history_import_row" ADD COLUMN "answers_removed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "history_import_row" ADD COLUMN "duplicates" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "imported_request" ADD COLUMN "reviewer_unmatched" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_correction" ADD COLUMN "source_md5" text;--> statement-breakpoint
-- #132: Bamboo exports no request date; imported requests stop carrying the submission date as one.
UPDATE "review_request" SET "requested_at" = NULL WHERE "source_system" = 'bamboo_export';
