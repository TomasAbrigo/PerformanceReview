CREATE TABLE "follow_up_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"author_person_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cycle_participant" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cycle_participant" ADD COLUMN "acknowledgement_note" text;--> statement-breakpoint
ALTER TABLE "follow_up_note" ADD CONSTRAINT "follow_up_note_participant_id_cycle_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."cycle_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_note" ADD CONSTRAINT "follow_up_note_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follow_up_note_participant_idx" ON "follow_up_note" USING btree ("participant_id","created_at");--> statement-breakpoint
ALTER TABLE "cycle_participant" ADD CONSTRAINT "cycle_participant_ack_note_ck" CHECK ("cycle_participant"."acknowledgement_note" IS NULL OR "cycle_participant"."acknowledged_at" IS NOT NULL);