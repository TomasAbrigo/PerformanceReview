CREATE TYPE "public"."source_system" AS ENUM('bamboo_api', 'bamboo_export', 'lake', 'native');--> statement-breakpoint
CREATE TABLE "raw_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"source_system" "source_system" NOT NULL,
	"entity" text NOT NULL,
	"source_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"extracted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"hire_date" date,
	"termination_date" date,
	"status" text,
	"source_system" "source_system" NOT NULL,
	"source_id" text NOT NULL,
	"ingest_run_id" uuid,
	"payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "employment_source_period_uq" UNIQUE NULLS NOT DISTINCT("source_system","source_id","hire_date")
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"work_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"source_system" "source_system" NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingest_run" ADD COLUMN "params" jsonb;--> statement-breakpoint
ALTER TABLE "ingest_run" ADD COLUMN "rejects" jsonb;--> statement-breakpoint
ALTER TABLE "raw_record" ADD CONSTRAINT "raw_record_run_id_ingest_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment" ADD CONSTRAINT "employment_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_identity" ADD CONSTRAINT "source_identity_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "raw_record_source_entity_id_hash_uq" ON "raw_record" USING btree ("source_system","entity","source_id","payload_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "source_identity_open_uq" ON "source_identity" USING btree ("source_system","kind","value") WHERE valid_to is null;