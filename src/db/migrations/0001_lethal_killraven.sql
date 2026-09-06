ALTER TABLE "idempotency_keys" ALTER COLUMN "response" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "status" text DEFAULT 'complete' NOT NULL;