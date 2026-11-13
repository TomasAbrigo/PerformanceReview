CREATE TYPE "public"."review_audit_action" AS ENUM('unlock');--> statement-breakpoint
CREATE TYPE "public"."review_relationship" AS ENUM('self', 'manager', 'peer', 'upward');--> statement-breakpoint
CREATE TYPE "public"."review_request_status" AS ENUM('draft', 'submitted', 'declined');--> statement-breakpoint
CREATE TABLE "answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"question_revision_id" uuid NOT NULL,
	"option_value" numeric,
	"option_label" text,
	"normalized" numeric,
	"text_value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answer_request_question_uq" UNIQUE("request_id","question_revision_id")
);
--> statement-breakpoint
CREATE TABLE "review_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"action" "review_audit_action" NOT NULL,
	"actor_person_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"reviewer_person_id" uuid NOT NULL,
	"relationship" "review_relationship" NOT NULL,
	"status" "review_request_status" DEFAULT 'draft' NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"unlocked_at" timestamp with time zone,
	"unlocked_by" uuid,
	"source_system" "source_system" DEFAULT 'native' NOT NULL,
	"source_id" text,
	"ingest_run_id" uuid,
	"payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "review_request_participant_rel_reviewer_uq" UNIQUE("participant_id","relationship","reviewer_person_id"),
	CONSTRAINT "review_request_source_system_source_id_unique" UNIQUE("source_system","source_id")
);
--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_request_id_review_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."review_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_question_revision_id_question_revision_id_fk" FOREIGN KEY ("question_revision_id") REFERENCES "public"."question_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_audit" ADD CONSTRAINT "review_audit_request_id_review_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."review_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_audit" ADD CONSTRAINT "review_audit_actor_person_id_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_participant_id_cycle_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."cycle_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_reviewer_person_id_person_id_fk" FOREIGN KEY ("reviewer_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_unlocked_by_person_id_fk" FOREIGN KEY ("unlocked_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_audit_request_idx" ON "review_audit" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "review_request_reviewer_idx" ON "review_request" USING btree ("reviewer_person_id","status");--> statement-breakpoint
CREATE INDEX "review_request_cycle_idx" ON "review_request" USING btree ("cycle_id");