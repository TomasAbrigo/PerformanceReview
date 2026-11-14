CREATE TYPE "public"."notification_kind" AS ENUM('reminder_due', 'manual_reminder', 'review_shared', 'feedback_received', 'calibration_published', 'cycle_phase_changed');--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"cycle_id" uuid,
	"request_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notification_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_person_id_person_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_request_id_review_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."review_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_inbox_idx" ON "notification" USING btree ("recipient_person_id",("read_at" is not null),"created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);