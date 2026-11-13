CREATE TABLE "employee_job_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"employment_id" uuid,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"manager_person_id" uuid,
	"manager_raw" text,
	"department" text,
	"division" text,
	"job_title" text,
	"location" text,
	"source_system" "source_system" DEFAULT 'native' NOT NULL,
	"source_id" text,
	"ingest_run_id" uuid,
	"payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "employee_job_history_person_from_uq" UNIQUE("person_id","valid_from")
);
--> statement-breakpoint
CREATE TABLE "employee_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"employment_status" text,
	"comment" text,
	"termination_raw" jsonb,
	"source_system" "source_system" DEFAULT 'native' NOT NULL,
	"source_id" text,
	"ingest_run_id" uuid,
	"payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "employee_status_history_person_from_uq" UNIQUE("person_id","valid_from")
);
--> statement-breakpoint
ALTER TABLE "employee_job_history" ADD CONSTRAINT "employee_job_history_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_job_history" ADD CONSTRAINT "employee_job_history_employment_id_employment_id_fk" FOREIGN KEY ("employment_id") REFERENCES "public"."employment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_job_history" ADD CONSTRAINT "employee_job_history_manager_person_id_person_id_fk" FOREIGN KEY ("manager_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_status_history" ADD CONSTRAINT "employee_status_history_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_job_history_manager_idx" ON "employee_job_history" USING btree ("manager_person_id","valid_from");