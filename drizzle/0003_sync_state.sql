CREATE TABLE "sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" "source_system" NOT NULL,
	"entity" text NOT NULL,
	"watermark" text,
	"cursor" text,
	"last_success_at" timestamp with time zone,
	"last_run_id" uuid,
	CONSTRAINT "sync_state_source_entity_uq" UNIQUE("source_system","entity")
);
--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_last_run_id_ingest_run_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."ingest_run"("id") ON DELETE no action ON UPDATE no action;