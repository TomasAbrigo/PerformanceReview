CREATE TYPE "public"."analysis_run_status" AS ENUM('running', 'succeeded', 'error');--> statement-breakpoint
CREATE TYPE "public"."sentiment" AS ENUM('positive', 'constructive', 'negative');--> statement-breakpoint
CREATE TABLE "analysis_correction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"previous_sentiment" "sentiment",
	"new_sentiment" "sentiment" NOT NULL,
	"previous_themes" text[],
	"new_themes" text[] NOT NULL,
	"actor_person_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"prompt_version" text NOT NULL,
	"status" "analysis_run_status" DEFAULT 'running' NOT NULL,
	"texts_total" integer DEFAULT 0 NOT NULL,
	"texts_analyzed" integer DEFAULT 0 NOT NULL,
	"texts_cached" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"cycle_id" uuid,
	"triggered_by" uuid
);
--> statement-breakpoint
CREATE TABLE "qualitative_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"prompt_version" text NOT NULL,
	"dimension" text NOT NULL,
	"sentiment" "sentiment" NOT NULL,
	"confidence" numeric,
	"themes" text[] DEFAULT '{}'::text[] NOT NULL,
	"text_hash" text NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qualitative_analysis_answer_provider_prompt_uq" UNIQUE("answer_id","provider","prompt_version"),
	CONSTRAINT "qualitative_analysis_confidence_ck" CHECK ("qualitative_analysis"."confidence" is null or ("qualitative_analysis"."confidence" >= 0 and "qualitative_analysis"."confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "theme" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dimension" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	CONSTRAINT "theme_dimension_name_uq" UNIQUE("dimension","normalized_name")
);
--> statement-breakpoint
ALTER TABLE "analysis_correction" ADD CONSTRAINT "analysis_correction_answer_id_answer_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_correction" ADD CONSTRAINT "analysis_correction_actor_person_id_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD CONSTRAINT "analysis_run_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD CONSTRAINT "analysis_run_triggered_by_person_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualitative_analysis" ADD CONSTRAINT "qualitative_analysis_answer_id_answer_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualitative_analysis" ADD CONSTRAINT "qualitative_analysis_run_id_analysis_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_correction_answer_idx" ON "analysis_correction" USING btree ("answer_id","created_at");