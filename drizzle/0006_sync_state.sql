CREATE TYPE "public"."ingest_run_status" AS ENUM('running', 'succeeded', 'error');--> statement-breakpoint
CREATE TABLE "sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" "source_system" NOT NULL,
	"adapter" text NOT NULL,
	"entity" text NOT NULL,
	"watermark" text,
	"cursor" text,
	"last_success_at" timestamp with time zone,
	"last_run_id" uuid,
	CONSTRAINT "sync_state_source_adapter_entity_uq" UNIQUE("source_system","adapter","entity")
);
--> statement-breakpoint
-- Data first: runs that threw used to end as 'failed' (now 'error'); anything
-- else that is not a known status (a null) cannot be told apart, so it is an error too.
UPDATE "ingest_run" SET "status" = 'error' WHERE "status" IS NULL OR "status" NOT IN ('running', 'succeeded', 'error');--> statement-breakpoint
UPDATE "ingest_run" SET "started_at" = coalesce("finished_at", now()) WHERE "started_at" IS NULL;--> statement-breakpoint
ALTER TABLE "ingest_run" ADD COLUMN "entity" text;--> statement-breakpoint
UPDATE "ingest_run" SET "entity" = coalesce("params"->>'entity', 'unknown');--> statement-breakpoint
ALTER TABLE "ingest_run" ALTER COLUMN "entity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest_run" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ingest_run" ALTER COLUMN "status" SET DATA TYPE "public"."ingest_run_status" USING "status"::"public"."ingest_run_status";--> statement-breakpoint
ALTER TABLE "ingest_run" ALTER COLUMN "status" SET DEFAULT 'running';--> statement-breakpoint
ALTER TABLE "ingest_run" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest_run" ALTER COLUMN "started_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_last_run_id_ingest_run_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_run_started_at_idx" ON "ingest_run" USING btree ("started_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ingest_run_entity_started_at_idx" ON "ingest_run" USING btree ("entity","started_at" DESC NULLS LAST,"id" DESC NULLS LAST);
