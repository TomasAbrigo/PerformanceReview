ALTER TYPE "public"."review_audit_action" ADD VALUE 'shared';--> statement-breakpoint
ALTER TYPE "public"."review_audit_action" ADD VALUE 'unshared';--> statement-breakpoint
ALTER TYPE "public"."review_audit_action" ADD VALUE 'reminder_sent';--> statement-breakpoint
ALTER TYPE "public"."review_audit_action" ADD VALUE 'reviewer_reassigned';--> statement-breakpoint
ALTER TABLE "review_request" DROP CONSTRAINT "review_request_participant_rel_reviewer_uq";--> statement-breakpoint
ALTER TABLE "review_request" ALTER COLUMN "reviewer_person_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "review_cycle" ADD COLUMN "calibration_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN "reviewer_missing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN "reviewer_mismatch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN "shared_by" uuid;--> statement-breakpoint
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_shared_by_person_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_participant_rel_reviewer_uq" UNIQUE NULLS NOT DISTINCT("participant_id","relationship","reviewer_person_id");