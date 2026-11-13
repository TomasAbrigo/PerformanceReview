CREATE TYPE "public"."cycle_status" AS ENUM('draft', 'nominations', 'collecting', 'manager_review', 'calibration', 'sharing', 'closed');--> statement-breakpoint
CREATE TYPE "public"."schedule_kind" AS ENUM('fixed', 'hire_date');--> statement-breakpoint
CREATE TABLE "cycle_participant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"reviewee_person_id" uuid NOT NULL,
	"snapshot_as_of" date NOT NULL,
	"snap_manager_person_id" uuid,
	"snap_department" text,
	"snap_division" text,
	"snap_job_title" text,
	"snap_location" text,
	"snap_job_history_id" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "cycle_participant_cycle_reviewee_uq" UNIQUE("cycle_id","reviewee_person_id")
);
--> statement-breakpoint
CREATE TABLE "cycle_transition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"from_status" "cycle_status" NOT NULL,
	"to_status" "cycle_status" NOT NULL,
	"actor_person_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"question_id" uuid,
	"section_title" jsonb NOT NULL,
	"prompt" jsonb NOT NULL,
	"kind" text NOT NULL,
	"applies_to" text[] NOT NULL,
	"visible_to_reviewee" boolean NOT NULL,
	"required" boolean NOT NULL,
	"scale" jsonb,
	"choices" jsonb,
	"sort" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_cycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"snapshot_date" date NOT NULL,
	"status" "cycle_status" DEFAULT 'draft' NOT NULL,
	"components" jsonb NOT NULL,
	"anonymity" jsonb NOT NULL,
	"final_scale_id" uuid,
	"template_id" uuid,
	"due_dates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule_kind" "schedule_kind" DEFAULT 'fixed' NOT NULL,
	"hire_date_schedule" jsonb,
	"participant_filter" jsonb DEFAULT '{"kind":"all"}'::jsonb NOT NULL,
	"launched_at" timestamp with time zone,
	"source_system" "source_system" DEFAULT 'native' NOT NULL,
	"source_id" text,
	"ingest_run_id" uuid,
	"payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "review_cycle_source_system_source_id_unique" UNIQUE("source_system","source_id")
);
--> statement-breakpoint
ALTER TABLE "cycle_participant" ADD CONSTRAINT "cycle_participant_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_participant" ADD CONSTRAINT "cycle_participant_reviewee_person_id_person_id_fk" FOREIGN KEY ("reviewee_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_participant" ADD CONSTRAINT "cycle_participant_snap_manager_person_id_person_id_fk" FOREIGN KEY ("snap_manager_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_participant" ADD CONSTRAINT "cycle_participant_snap_job_history_id_employee_job_history_id_fk" FOREIGN KEY ("snap_job_history_id") REFERENCES "public"."employee_job_history"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_transition" ADD CONSTRAINT "cycle_transition_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_transition" ADD CONSTRAINT "cycle_transition_actor_person_id_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_revision" ADD CONSTRAINT "question_revision_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_revision" ADD CONSTRAINT "question_revision_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cycle" ADD CONSTRAINT "review_cycle_final_scale_id_rating_scale_id_fk" FOREIGN KEY ("final_scale_id") REFERENCES "public"."rating_scale"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cycle" ADD CONSTRAINT "review_cycle_template_id_review_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."review_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cycle_transition_cycle_idx" ON "cycle_transition" USING btree ("cycle_id","created_at");--> statement-breakpoint
CREATE INDEX "question_revision_cycle_idx" ON "question_revision" USING btree ("cycle_id","sort");