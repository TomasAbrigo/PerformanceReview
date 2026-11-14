CREATE TABLE "cycle_goal_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"linked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_goal_link_cycle_goal_uq" UNIQUE("cycle_id","goal_id")
);
--> statement-breakpoint
CREATE TABLE "participant_goal_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"goal_id" uuid,
	"goal_source_key" text NOT NULL,
	"title" text NOT NULL,
	"status" "goal_status" NOT NULL,
	"percent_complete" integer NOT NULL,
	"due_date" date,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refreshed_at" timestamp with time zone,
	"no_longer_applicable" boolean DEFAULT false NOT NULL,
	CONSTRAINT "participant_goal_snapshot_participant_goal_uq" UNIQUE("participant_id","goal_source_key")
);
--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "question_revision" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "cycle_goal_link" ADD CONSTRAINT "cycle_goal_link_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_goal_link" ADD CONSTRAINT "cycle_goal_link_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_goal_link" ADD CONSTRAINT "cycle_goal_link_linked_by_person_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_goal_snapshot" ADD CONSTRAINT "participant_goal_snapshot_participant_id_cycle_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."cycle_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_goal_snapshot" ADD CONSTRAINT "participant_goal_snapshot_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "participant_goal_snapshot_goal_idx" ON "participant_goal_snapshot" USING btree ("goal_id");--> statement-breakpoint
-- Backfill: mark the goals rating, its comment and the overall rating in templates created before roles existed (the system year-end template and its clones), then in the revisions of the cycles already launched (by their template question, else by their own prompt).
UPDATE "question" SET "role" = 'goals_rating' WHERE "kind" = 'rating' AND "applies_to" = ARRAY['manager']::text[] AND "prompt"->>'es' = '¿Cómo calificarías el avance en sus objetivos?';--> statement-breakpoint
UPDATE "question" SET "role" = 'goals_comment' WHERE "kind" = 'text' AND "applies_to" = ARRAY['manager']::text[] AND "prompt"->>'es' = 'Comenta el avance en sus objetivos.';--> statement-breakpoint
UPDATE "question" SET "role" = 'overall_rating' WHERE "kind" = 'rating' AND "applies_to" = ARRAY['manager']::text[] AND "prompt"->>'es' = 'Calificación general de desempeño';--> statement-breakpoint
UPDATE "question_revision" r SET "role" = q."role" FROM "question" q WHERE r."question_id" = q."id" AND r."role" IS NULL AND q."role" IS NOT NULL;--> statement-breakpoint
UPDATE "question_revision" SET "role" = 'goals_rating' WHERE "role" IS NULL AND "kind" = 'rating' AND "applies_to" = ARRAY['manager']::text[] AND "prompt"->>'es' = '¿Cómo calificarías el avance en sus objetivos?';--> statement-breakpoint
UPDATE "question_revision" SET "role" = 'goals_comment' WHERE "role" IS NULL AND "kind" = 'text' AND "applies_to" = ARRAY['manager']::text[] AND "prompt"->>'es' = 'Comenta el avance en sus objetivos.';--> statement-breakpoint
UPDATE "question_revision" SET "role" = 'overall_rating' WHERE "role" IS NULL AND "kind" = 'rating' AND "applies_to" = ARRAY['manager']::text[] AND "prompt"->>'es' = 'Calificación general de desempeño';
