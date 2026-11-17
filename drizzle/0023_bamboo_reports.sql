CREATE TYPE "public"."progress_status" AS ENUM('not_started', 'in_progress', 'submitted', 'not_applicable');--> statement-breakpoint
ALTER TYPE "public"."ingest_run_status" ADD VALUE 'needs_decision';--> statement-breakpoint
CREATE TABLE "assessment_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"self_status" "progress_status" NOT NULL,
	"manager_status" "progress_status" NOT NULL,
	"assessed" boolean NOT NULL,
	"follow_up_notes" text,
	"csv_manager_name" text,
	"reviewer_mismatch" boolean DEFAULT false NOT NULL,
	"source_system" "source_system" NOT NULL,
	"source_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"ingest_run_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_progress_cycle_participant_uq" UNIQUE("cycle_id","participant_id")
);
--> statement-breakpoint
ALTER TABLE "assessment_progress" ADD CONSTRAINT "assessment_progress_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_progress" ADD CONSTRAINT "assessment_progress_participant_id_cycle_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."cycle_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_progress" ADD CONSTRAINT "assessment_progress_ingest_run_id_ingest_run_id_fk" FOREIGN KEY ("ingest_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE set null ON UPDATE no action;