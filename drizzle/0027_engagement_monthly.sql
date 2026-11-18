CREATE TYPE "public"."engagement_segment" AS ENUM('alto', 'medio', 'regular', 'bajo', 'falta');--> statement-breakpoint
CREATE TABLE "engagement_monthly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"month" date NOT NULL,
	"score" numeric(5, 4),
	"segment" "engagement_segment" NOT NULL,
	"source_system" "source_system" DEFAULT 'native' NOT NULL,
	"source_id" text,
	"ingest_run_id" uuid,
	"payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "engagement_monthly_person_month_uq" UNIQUE("person_id","month"),
	CONSTRAINT "engagement_monthly_score_range" CHECK ("engagement_monthly"."score" is null or ("engagement_monthly"."score" >= 0 and "engagement_monthly"."score" <= 1)),
	CONSTRAINT "engagement_monthly_month_first" CHECK (extract(day from "engagement_monthly"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "engagement_monthly" ADD CONSTRAINT "engagement_monthly_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "engagement_monthly_month_idx" ON "engagement_monthly" USING btree ("month");