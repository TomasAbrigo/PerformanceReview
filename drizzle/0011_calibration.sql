CREATE TYPE "public"."calibration_group_kind" AS ENUM('by_department', 'by_manager', 'manual');--> statement-breakpoint
CREATE TYPE "public"."final_rating_stage" AS ENUM('computed', 'manager', 'calibrated', 'override');--> statement-breakpoint
ALTER TYPE "public"."review_audit_action" ADD VALUE 'calibration_published';--> statement-breakpoint
CREATE TABLE "calibration_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "calibration_group_kind" NOT NULL,
	"criteria" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_group_calibrator" (
	"group_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"read_only" boolean DEFAULT true NOT NULL,
	CONSTRAINT "calibration_group_calibrator_group_id_person_id_pk" PRIMARY KEY("group_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "calibration_group_member" (
	"group_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	CONSTRAINT "calibration_group_member_group_id_participant_id_pk" PRIMARY KEY("group_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "final_rating" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"stage" "final_rating_stage" NOT NULL,
	"option_value" numeric NOT NULL,
	"option_label" text,
	"normalized" numeric,
	"actor_person_id" uuid,
	"reason" text,
	"flagged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_cycle" ADD COLUMN "calibration_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calibration_group" ADD CONSTRAINT "calibration_group_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_group" ADD CONSTRAINT "calibration_group_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_group_calibrator" ADD CONSTRAINT "calibration_group_calibrator_group_id_calibration_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."calibration_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_group_calibrator" ADD CONSTRAINT "calibration_group_calibrator_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_group_member" ADD CONSTRAINT "calibration_group_member_group_id_calibration_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."calibration_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_group_member" ADD CONSTRAINT "calibration_group_member_participant_id_cycle_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."cycle_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_rating" ADD CONSTRAINT "final_rating_participant_id_cycle_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."cycle_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_rating" ADD CONSTRAINT "final_rating_actor_person_id_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calibration_group_cycle_idx" ON "calibration_group" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "final_rating_participant_idx" ON "final_rating" USING btree ("participant_id","created_at");--> statement-breakpoint
CREATE VIEW "v_current_rating" AS SELECT DISTINCT ON ("participant_id") "id", "participant_id", "stage", "option_value", "option_label", "normalized", "actor_person_id", "reason", "flagged", "created_at" FROM "final_rating" ORDER BY "participant_id", CASE "stage" WHEN 'override' THEN 4 WHEN 'calibrated' THEN 3 WHEN 'manager' THEN 2 ELSE 1 END DESC, "created_at" DESC, "id" DESC;
