CREATE TABLE "history_import_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"source_id" text NOT NULL,
	"cycle_id" uuid,
	"result" text NOT NULL,
	"participants_created" integer DEFAULT 0 NOT NULL,
	"requests_created" integer DEFAULT 0 NOT NULL,
	"requests_unchanged" integer DEFAULT 0 NOT NULL,
	"answers_created" integer DEFAULT 0 NOT NULL,
	"answers_unchanged" integer DEFAULT 0 NOT NULL,
	"issue_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "history_import_row_run_record_uq" UNIQUE("run_id","entity","source_id")
);
--> statement-breakpoint
CREATE TABLE "imported_question" (
	"cycle_id" uuid NOT NULL,
	"column_key" text NOT NULL,
	"question_revision_id" uuid NOT NULL,
	CONSTRAINT "imported_question_cycle_id_column_key_pk" PRIMARY KEY("cycle_id","column_key")
);
--> statement-breakpoint
CREATE TABLE "imported_request" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"csv_reviewer_name" text,
	"reviewer_mismatch" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "history_import_row" ADD CONSTRAINT "history_import_row_run_id_ingest_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingest_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_import_row" ADD CONSTRAINT "history_import_row_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_import_row" ADD CONSTRAINT "history_import_row_issue_id_identity_match_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."identity_match_issue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_question" ADD CONSTRAINT "imported_question_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_question" ADD CONSTRAINT "imported_question_question_revision_id_question_revision_id_fk" FOREIGN KEY ("question_revision_id") REFERENCES "public"."question_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_request" ADD CONSTRAINT "imported_request_request_id_review_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."review_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "history_import_row_cycle_idx" ON "history_import_row" USING btree ("run_id","cycle_id");