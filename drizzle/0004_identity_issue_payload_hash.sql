ALTER TABLE "identity_match_issue" ADD COLUMN "payload_hash" text;--> statement-breakpoint
UPDATE "identity_match_issue" i SET "payload_hash" = r."payload_hash" FROM "raw_record" r WHERE r."id" = i."raw_record_id";--> statement-breakpoint
UPDATE "identity_match_issue" SET "payload_hash" = '' WHERE "payload_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "identity_match_issue" ALTER COLUMN "payload_hash" SET NOT NULL;
