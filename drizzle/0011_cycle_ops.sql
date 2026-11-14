ALTER TYPE "public"."review_request_status" ADD VALUE 'superseded';--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_person_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN "reviewer_mismatch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN "additional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN "submitted_on_behalf" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN "submitted_on_behalf_by" uuid;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_person_id_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_log_cycle_idx" ON "admin_audit_log" USING btree ("cycle_id","created_at");--> statement-breakpoint
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_submitted_on_behalf_by_person_id_fk" FOREIGN KEY ("submitted_on_behalf_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;