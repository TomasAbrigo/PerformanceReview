CREATE TYPE "public"."identity_issue_reason" AS ENUM('no_match', 'ambiguous', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."identity_issue_status" AS ENUM('open', 'resolved', 'ignored');--> statement-breakpoint
CREATE TABLE "identity_match_issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingest_run_id" uuid NOT NULL,
	"source_system" "source_system" NOT NULL,
	"entity" text NOT NULL,
	"source_id" text NOT NULL,
	"raw_record_id" uuid,
	"payload" jsonb NOT NULL,
	"reason" "identity_issue_reason" NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "identity_issue_status" DEFAULT 'open' NOT NULL,
	"resolution" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "identity_match_issue" ADD CONSTRAINT "identity_match_issue_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_match_issue" ADD CONSTRAINT "identity_match_issue_raw_record_id_raw_record_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."raw_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_match_issue_open_uq" ON "identity_match_issue" USING btree ("source_system","entity","source_id") WHERE status = 'open';