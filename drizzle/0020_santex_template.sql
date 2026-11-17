CREATE TABLE "answer_quality_issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid,
	"request_id" uuid NOT NULL,
	"question_revision_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"column_key" text NOT NULL,
	"raw_value" text NOT NULL,
	"reason" text NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "answer_quality_issue_request_question_uq" UNIQUE("request_id","question_revision_id")
);
--> statement-breakpoint
CREATE TABLE "likert_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"source_option" text NOT NULL,
	"option_count" integer NOT NULL,
	"value" integer NOT NULL,
	"source" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "likert_mapping_role_count_option_uq" UNIQUE("role","option_count","source_option")
);
--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "dimension" text;--> statement-breakpoint
ALTER TABLE "question_revision" ADD COLUMN "dimension" text;--> statement-breakpoint
ALTER TABLE "answer_quality_issue" ADD CONSTRAINT "answer_quality_issue_answer_id_answer_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_quality_issue" ADD CONSTRAINT "answer_quality_issue_request_id_review_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."review_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_quality_issue" ADD CONSTRAINT "answer_quality_issue_question_revision_id_question_revision_id_fk" FOREIGN KEY ("question_revision_id") REFERENCES "public"."question_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_quality_issue" ADD CONSTRAINT "answer_quality_issue_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_quality_issue" ADD CONSTRAINT "answer_quality_issue_run_id_ingest_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingest_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_quality_issue_cycle_idx" ON "answer_quality_issue" USING btree ("cycle_id");