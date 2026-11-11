-- Idempotent repair when 0018/0019 were recorded through a transaction-mode pooler but DDL did not land.
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "alternate_names" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "phone" text;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN IF NOT EXISTS "phone_number" text;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN IF NOT EXISTS "phone_number_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "social_auth_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"profile_name" jsonb NOT NULL,
	"reason" text NOT NULL,
	"candidate_guest_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"linked_guest_id" text,
	"linked_auth_identity_id" text,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_auth_reviews_status_idx" ON "social_auth_reviews" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_auth_reviews_provider_idx" ON "social_auth_reviews" USING btree ("provider_id","provider_account_id");--> statement-breakpoint
ALTER TABLE "social_auth_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_users_phone_idx" ON "auth_users" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guests_phone_idx" ON "guests" USING btree ("phone");
