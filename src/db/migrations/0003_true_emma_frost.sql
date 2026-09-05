CREATE SCHEMA "biometric";
--> statement-breakpoint
CREATE TABLE "media_ai_annotations" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"error" text,
	"caption_source" text DEFAULT 'none' NOT NULL,
	"suggested_caption" text,
	"suggested_alt_text" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"venue_class" text DEFAULT 'unknown' NOT NULL,
	"schedule_slot" text DEFAULT 'unknown' NOT NULL,
	"scenes" jsonb,
	"derivative_key" text,
	"caption_model" text,
	"caption_confidence" real,
	"embedding_model" text,
	"embedding_dims" real,
	"index_text" text,
	"indexed_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_ai_clusters" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"asset_ids" jsonb NOT NULL,
	"representative_asset_id" text NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biometric"."consents" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"household_id" text NOT NULL,
	"entry" text NOT NULL,
	"grant_id" text,
	"policy_version" text NOT NULL,
	"text_hash" text NOT NULL,
	"text" text NOT NULL,
	"purpose" text NOT NULL,
	"term" text NOT NULL,
	"retention" text NOT NULL,
	"provider_disclosure" text NOT NULL,
	"scope" text DEFAULT 'self_match' NOT NULL,
	"adult_attested" boolean DEFAULT false NOT NULL,
	"ip_hash" text,
	"surface" text DEFAULT 'ui' NOT NULL,
	"request_id" text NOT NULL,
	"granted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biometric"."deletions" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by" jsonb NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"proof" jsonb,
	"error" text,
	"job_id" text,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biometric"."identity_refs" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"consent_id" text NOT NULL,
	"provider_name" text NOT NULL,
	"subject_id" text NOT NULL,
	"template_sealed" text NOT NULL,
	"template_key_id" text NOT NULL,
	"source_asset_ids" jsonb NOT NULL,
	"enrolled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biometric"."matches" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"identity_ref_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"score" real NOT NULL,
	"matched_at" timestamp with time zone NOT NULL,
	"request_id" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "media_ai_annotations_asset_idx" ON "media_ai_annotations" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "media_ai_annotations_status_idx" ON "media_ai_annotations" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_ai_clusters_kind_key_idx" ON "media_ai_clusters" USING btree ("kind","key");--> statement-breakpoint
CREATE INDEX "media_ai_clusters_kind_idx" ON "media_ai_clusters" USING btree ("kind","computed_at");--> statement-breakpoint
CREATE INDEX "biometric_consents_guest_idx" ON "biometric"."consents" USING btree ("guest_id","created_at");--> statement-breakpoint
CREATE INDEX "biometric_consents_grant_idx" ON "biometric"."consents" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "biometric_deletions_guest_idx" ON "biometric"."deletions" USING btree ("guest_id","requested_at");--> statement-breakpoint
CREATE INDEX "biometric_deletions_status_idx" ON "biometric"."deletions" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "biometric_identity_refs_guest_idx" ON "biometric"."identity_refs" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "biometric_matches_guest_idx" ON "biometric"."matches" USING btree ("guest_id","matched_at");--> statement-breakpoint
CREATE INDEX "biometric_matches_asset_idx" ON "biometric"."matches" USING btree ("asset_id");