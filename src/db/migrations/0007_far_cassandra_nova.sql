CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"upload_id" text,
	"source" text NOT NULL,
	"owner_guest_id" text,
	"owner_household_id" text,
	"vendor" text,
	"created_by" jsonb NOT NULL,
	"collection_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'quarantined' NOT NULL,
	"content_type" text NOT NULL,
	"original_key" text,
	"quarantine_key" text,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"sha256" text,
	"dhash" text,
	"width" integer,
	"height" integer,
	"duration_seconds" integer,
	"captured_at" timestamp with time zone,
	"camera_make" text,
	"camera_model" text,
	"original_filename" text,
	"had_location" boolean DEFAULT false NOT NULL,
	"caption" text,
	"alt_text" text,
	"visibility" text,
	"allow_download" boolean DEFAULT false NOT NULL,
	"allow_ai_processing" boolean DEFAULT false NOT NULL,
	"license_note" text,
	"quality_signals" jsonb,
	"video_asset_id" text,
	"processing_error" text,
	"duplicate_of_asset_id" text,
	"report_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"moderated_at" timestamp with time zone,
	"moderated_by" jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"chapter" text,
	"visibility" text DEFAULT 'guests' NOT NULL,
	"accepts_uploads" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"cover_asset_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_derivatives" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"variant" text NOT NULL,
	"format" text NOT NULL,
	"key" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" bigint NOT NULL,
	"metadata_stripped" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_moderation" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"action" text NOT NULL,
	"actor" jsonb NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"reason" text,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"uploader" jsonb NOT NULL,
	"owner_guest_id" text,
	"owner_household_id" text,
	"source" text NOT NULL,
	"vendor" text,
	"rights_draft" jsonb,
	"collection_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"filename" text NOT NULL,
	"declared_content_type" text NOT NULL,
	"declared_bytes" bigint NOT NULL,
	"client_fingerprint" text,
	"caption" text,
	"quarantine_key" text NOT NULL,
	"multipart" boolean DEFAULT false NOT NULL,
	"storage_upload_id" text,
	"part_size" integer NOT NULL,
	"part_count" integer NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"url_expires_at" timestamp with time zone NOT NULL,
	"url_generation" integer DEFAULT 1 NOT NULL,
	"asset_id" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "professional_media_rights" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"vendor" text NOT NULL,
	"vendor_name" text NOT NULL,
	"provenance" text NOT NULL,
	"copyright_holder" text NOT NULL,
	"usage_notes" text,
	"license_note" text NOT NULL,
	"allow_ai_processing" boolean DEFAULT false NOT NULL,
	"ai_processing_confirmation_ref" text,
	"ai_processing_confirmed_at" timestamp with time zone,
	"publication_approved" boolean DEFAULT false NOT NULL,
	"publication_approved_by" jsonb,
	"publication_approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_upload_id_media_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."media_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_guest_id_guests_id_fk" FOREIGN KEY ("owner_guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_household_id_households_id_fk" FOREIGN KEY ("owner_household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_collection_id_media_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."media_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_collections" ADD CONSTRAINT "media_collections_cover_asset_id_media_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_derivatives" ADD CONSTRAINT "media_derivatives_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_moderation" ADD CONSTRAINT "media_moderation_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_owner_guest_id_guests_id_fk" FOREIGN KEY ("owner_guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_owner_household_id_households_id_fk" FOREIGN KEY ("owner_household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_collection_id_media_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."media_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_media_rights" ADD CONSTRAINT "professional_media_rights_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_collection_status_idx" ON "media_assets" USING btree ("collection_id","status","captured_at");--> statement-breakpoint
CREATE INDEX "media_assets_owner_idx" ON "media_assets" USING btree ("owner_guest_id","created_at");--> statement-breakpoint
CREATE INDEX "media_assets_sha256_idx" ON "media_assets" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "media_assets_status_idx" ON "media_assets" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_collections_slug_idx" ON "media_collections" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "media_derivatives_asset_variant_format_idx" ON "media_derivatives" USING btree ("asset_id","variant","format");--> statement-breakpoint
CREATE INDEX "media_derivatives_asset_idx" ON "media_derivatives" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "media_moderation_asset_idx" ON "media_moderation" USING btree ("asset_id","created_at");--> statement-breakpoint
CREATE INDEX "media_uploads_owner_idx" ON "media_uploads" USING btree ("owner_guest_id","created_at");--> statement-breakpoint
CREATE INDEX "media_uploads_status_idx" ON "media_uploads" USING btree ("status","url_expires_at");--> statement-breakpoint
CREATE INDEX "media_uploads_fingerprint_idx" ON "media_uploads" USING btree ("owner_guest_id","client_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "professional_media_rights_asset_idx" ON "professional_media_rights" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "professional_media_rights_vendor_idx" ON "professional_media_rights" USING btree ("vendor");