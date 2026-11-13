CREATE TABLE "rating_scale" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" jsonb NOT NULL,
	"system_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"source_system" text DEFAULT 'native' NOT NULL,
	"source_id" text,
	"ingest_run_id" uuid,
	"payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_scale_system_key_unique" UNIQUE("system_key"),
	CONSTRAINT "rating_scale_source_system_source_id_unique" UNIQUE("source_system","source_id")
);
--> statement-breakpoint
CREATE TABLE "rating_scale_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scale_id" uuid NOT NULL,
	"value" numeric NOT NULL,
	"normalized" numeric NOT NULL,
	"sort" integer NOT NULL,
	"label" jsonb NOT NULL,
	CONSTRAINT "rating_scale_option_scale_id_value_unique" UNIQUE("scale_id","value")
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"sort" integer NOT NULL,
	"kind" text NOT NULL,
	"applies_to" text[] NOT NULL,
	"visible_to_reviewee" boolean DEFAULT true NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"scale_id" uuid,
	"prompt" jsonb NOT NULL,
	"choices" jsonb
);
--> statement-breakpoint
CREATE TABLE "review_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"system_key" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cloned_from_id" uuid,
	"source_system" text DEFAULT 'native' NOT NULL,
	"source_id" text,
	"ingest_run_id" uuid,
	"payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_template_system_key_unique" UNIQUE("system_key"),
	CONSTRAINT "review_template_source_system_source_id_unique" UNIQUE("source_system","source_id")
);
--> statement-breakpoint
CREATE TABLE "template_section" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"sort" integer NOT NULL,
	"title" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rating_scale_option" ADD CONSTRAINT "rating_scale_option_scale_id_rating_scale_id_fk" FOREIGN KEY ("scale_id") REFERENCES "public"."rating_scale"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_section_id_template_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."template_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_scale_id_rating_scale_id_fk" FOREIGN KEY ("scale_id") REFERENCES "public"."rating_scale"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_template" ADD CONSTRAINT "review_template_cloned_from_id_review_template_id_fk" FOREIGN KEY ("cloned_from_id") REFERENCES "public"."review_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_section" ADD CONSTRAINT "template_section_template_id_review_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."review_template"("id") ON DELETE cascade ON UPDATE no action;