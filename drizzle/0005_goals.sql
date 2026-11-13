CREATE TYPE "public"."goal_status" AS ENUM('in_progress', 'completed', 'closed');--> statement-breakpoint
CREATE TABLE "goal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"percent_complete" integer DEFAULT 0 NOT NULL,
	"status" "goal_status" DEFAULT 'in_progress' NOT NULL,
	"due_date" date,
	"completion_date" date,
	"last_changed_at" timestamp with time zone,
	"aligns_with_source_id" text,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"source_system" "source_system" DEFAULT 'native' NOT NULL,
	"source_id" text,
	"ingest_run_id" uuid,
	"payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "goal_source_uq" UNIQUE("source_system","source_id"),
	CONSTRAINT "goal_percent_complete_range" CHECK ("goal"."percent_complete" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "goal_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"author_person_id" uuid,
	"author_source_user_id" text,
	"text" text NOT NULL,
	"posted_at" timestamp with time zone,
	"source_system" "source_system" DEFAULT 'native' NOT NULL,
	"source_id" text,
	"ingest_run_id" uuid,
	"payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "goal_comment_source_uq" UNIQUE("source_system","source_id")
);
--> statement-breakpoint
CREATE TABLE "goal_milestone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"last_update_at" timestamp with time zone,
	"source_system" "source_system" DEFAULT 'native' NOT NULL,
	"source_id" text,
	"ingest_run_id" uuid,
	"payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "goal_milestone_source_uq" UNIQUE("source_system","source_id")
);
--> statement-breakpoint
CREATE TABLE "goal_share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_share_goal_person_uq" UNIQUE("goal_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_comment" ADD CONSTRAINT "goal_comment_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_comment" ADD CONSTRAINT "goal_comment_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_milestone" ADD CONSTRAINT "goal_milestone_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_share" ADD CONSTRAINT "goal_share_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_share" ADD CONSTRAINT "goal_share_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_person_idx" ON "goal" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "goal_comment_goal_idx" ON "goal_comment" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goal_milestone_goal_idx" ON "goal_milestone" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goal_share_person_idx" ON "goal_share" USING btree ("person_id");