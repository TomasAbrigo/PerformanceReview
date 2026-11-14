CREATE TABLE "cycle_template_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"name" text NOT NULL,
	"template_id" uuid NOT NULL,
	"filter" jsonb NOT NULL,
	"sort" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_template_group_cycle_sort_uq" UNIQUE("cycle_id","sort")
);
--> statement-breakpoint
ALTER TABLE "cycle_participant" ADD COLUMN "template_group_id" uuid;--> statement-breakpoint
ALTER TABLE "cycle_participant" ADD COLUMN "due_dates" jsonb;--> statement-breakpoint
ALTER TABLE "question_revision" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "cycle_template_group" ADD CONSTRAINT "cycle_template_group_cycle_id_review_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_template_group" ADD CONSTRAINT "cycle_template_group_template_id_review_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."review_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_participant" ADD CONSTRAINT "cycle_participant_template_group_id_cycle_template_group_id_fk" FOREIGN KEY ("template_group_id") REFERENCES "public"."cycle_template_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_revision" ADD CONSTRAINT "question_revision_group_id_cycle_template_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."cycle_template_group"("id") ON DELETE cascade ON UPDATE no action;