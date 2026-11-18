CREATE TYPE "public"."org_attribute_kind" AS ENUM('account', 'project', 'dm', 'santex_lead');--> statement-breakpoint
CREATE TABLE "person_org_attribute" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "org_attribute_kind" NOT NULL,
	"value" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"ref_person_id" uuid,
	"source_system" "source_system" DEFAULT 'native' NOT NULL,
	"source_id" text,
	"ingest_run_id" uuid,
	"payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "person_org_attribute_person_kind_from_uq" UNIQUE("person_id","kind","valid_from")
);
--> statement-breakpoint
ALTER TABLE "person_org_attribute" ADD CONSTRAINT "person_org_attribute_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_org_attribute" ADD CONSTRAINT "person_org_attribute_ref_person_id_person_id_fk" FOREIGN KEY ("ref_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_org_attribute_kind_value_idx" ON "person_org_attribute" USING btree ("kind","value");