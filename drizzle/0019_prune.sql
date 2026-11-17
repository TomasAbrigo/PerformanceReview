ALTER TABLE "calibration_group" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calibration_group_calibrator" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calibration_group_member" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cycle_transition" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_audit" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "follow_up_note" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "peer_nomination" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "calibration_group" CASCADE;--> statement-breakpoint
DROP TABLE "calibration_group_calibrator" CASCADE;--> statement-breakpoint
DROP TABLE "calibration_group_member" CASCADE;--> statement-breakpoint
DROP TABLE "cycle_transition" CASCADE;--> statement-breakpoint
DROP TABLE "review_audit" CASCADE;--> statement-breakpoint
DROP TABLE "follow_up_note" CASCADE;--> statement-breakpoint
DROP TABLE "peer_nomination" CASCADE;--> statement-breakpoint
DROP TABLE "notification" CASCADE;--> statement-breakpoint
ALTER TABLE "cycle_participant" DROP CONSTRAINT "cycle_participant_ack_note_ck";--> statement-breakpoint
ALTER TABLE "review_request" DROP CONSTRAINT "review_request_unlocked_by_person_id_fk";
--> statement-breakpoint
ALTER TABLE "review_request" DROP CONSTRAINT "review_request_submitted_on_behalf_by_person_id_fk";
--> statement-breakpoint
ALTER TABLE "review_request" DROP CONSTRAINT "review_request_shared_by_person_id_fk";
--> statement-breakpoint
ALTER TABLE "cycle_participant" DROP COLUMN "due_dates";--> statement-breakpoint
ALTER TABLE "cycle_participant" DROP COLUMN "acknowledged_at";--> statement-breakpoint
ALTER TABLE "cycle_participant" DROP COLUMN "acknowledgement_note";--> statement-breakpoint
ALTER TABLE "review_cycle" DROP COLUMN "schedule_kind";--> statement-breakpoint
ALTER TABLE "review_cycle" DROP COLUMN "hire_date_schedule";--> statement-breakpoint
ALTER TABLE "review_cycle" DROP COLUMN "participant_filter";--> statement-breakpoint
ALTER TABLE "review_request" DROP COLUMN "unlocked_at";--> statement-breakpoint
ALTER TABLE "review_request" DROP COLUMN "unlocked_by";--> statement-breakpoint
ALTER TABLE "review_request" DROP COLUMN "additional";--> statement-breakpoint
ALTER TABLE "review_request" DROP COLUMN "assigned_by_hr";--> statement-breakpoint
ALTER TABLE "review_request" DROP COLUMN "submitted_on_behalf";--> statement-breakpoint
ALTER TABLE "review_request" DROP COLUMN "submitted_on_behalf_by";--> statement-breakpoint
ALTER TABLE "review_request" DROP COLUMN "shared_by";--> statement-breakpoint
DROP TYPE "public"."calibration_group_kind";--> statement-breakpoint
DROP TYPE "public"."schedule_kind";--> statement-breakpoint
DROP TYPE "public"."review_audit_action";--> statement-breakpoint
DROP TYPE "public"."peer_nomination_status";--> statement-breakpoint
DROP TYPE "public"."notification_kind";