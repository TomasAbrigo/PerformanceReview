CREATE TYPE "public"."peer_nomination_status" AS ENUM('pending', 'approved', 'declined', 'removed');--> statement-breakpoint
CREATE TABLE "peer_nomination" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"nominee_person_id" uuid NOT NULL,
	"nominated_by_person_id" uuid,
	"status" "peer_nomination_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peer_nomination_participant_nominee_uq" UNIQUE("participant_id","nominee_person_id")
);
--> statement-breakpoint
ALTER TABLE "peer_nomination" ADD CONSTRAINT "peer_nomination_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_nomination" ADD CONSTRAINT "peer_nomination_participant_id_cycle_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."cycle_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_nomination" ADD CONSTRAINT "peer_nomination_nominee_person_id_person_id_fk" FOREIGN KEY ("nominee_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_nomination" ADD CONSTRAINT "peer_nomination_nominated_by_person_id_person_id_fk" FOREIGN KEY ("nominated_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_nomination" ADD CONSTRAINT "peer_nomination_decided_by_person_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "peer_nomination_cycle_idx" ON "peer_nomination" USING btree ("cycle_id","status");