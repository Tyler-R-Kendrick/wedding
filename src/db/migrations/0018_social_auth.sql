ALTER TABLE "guests" ADD COLUMN "alternate_names" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "social_auth_reviews" (
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
CREATE INDEX "social_auth_reviews_status_idx" ON "social_auth_reviews" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "social_auth_reviews_provider_idx" ON "social_auth_reviews" USING btree ("provider_id","provider_account_id");--> statement-breakpoint
ALTER TABLE "social_auth_reviews" ENABLE ROW LEVEL SECURITY;
