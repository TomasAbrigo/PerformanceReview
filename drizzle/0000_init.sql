CREATE TABLE "ingest_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" text,
	"adapter" text,
	"status" text,
	"started_at" timestamp with time zone DEFAULT now(),
	"finished_at" timestamp with time zone,
	"counts" jsonb,
	"error" text
);
