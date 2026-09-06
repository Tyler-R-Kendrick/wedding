CREATE TABLE "adventure_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"date_exact" date,
	"date_approx" text,
	"season" text,
	"time_of_day" text,
	"place_id" text,
	"location_label" text,
	"lat" double precision,
	"lng" double precision,
	"summary" text NOT NULL,
	"memory" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sara_memory" text,
	"tyler_memory" text,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_minutes" integer,
	"accessibility_notes" text,
	"related_recommendation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"verified_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"trust_class" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"edited_by" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"placeholder" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"record_id" text NOT NULL,
	"content_version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"edited_by" text NOT NULL,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "faq_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"order" integer NOT NULL,
	"category" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"route" text,
	"source_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"verified_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"trust_class" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"edited_by" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"placeholder" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itinerary_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"bucket" text NOT NULL,
	"intro" text,
	"min_minutes" integer,
	"max_minutes" integer,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"draft" boolean DEFAULT true NOT NULL,
	"source_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"verified_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"trust_class" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"edited_by" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"placeholder" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"value" text,
	"url" text,
	"note" text,
	"order" integer DEFAULT 0 NOT NULL,
	"source_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"verified_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"trust_class" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"edited_by" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"placeholder" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"address" text,
	"city" text,
	"region" text,
	"lat" double precision,
	"lng" double precision,
	"url" text,
	"resy_slug" text,
	"open_table_id" text,
	"inside_venue" boolean DEFAULT false NOT NULL,
	"source_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"verified_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"trust_class" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"edited_by" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"placeholder" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"place_id" text,
	"what" text NOT NULL,
	"duration_minutes" integer,
	"distance_from_caa" text,
	"cost" text,
	"accessibility" text,
	"booking_url" text,
	"operational_key" text,
	"experience_id" text,
	"why_we_share_this" text,
	"kid_friendly" boolean,
	"draft" boolean DEFAULT true NOT NULL,
	"source_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"verified_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"trust_class" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"edited_by" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"placeholder" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"chapter" text NOT NULL,
	"order" integer NOT NULL,
	"title" text NOT NULL,
	"paragraphs" jsonb NOT NULL,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"verified_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"trust_class" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"edited_by" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"placeholder" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"order" integer NOT NULL,
	"category" text NOT NULL,
	"statement" text NOT NULL,
	"note" text,
	"source_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"verified_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"trust_class" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"edited_by" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"placeholder" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_spaces" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"order" integer NOT NULL,
	"character" text NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capacities" jsonb NOT NULL,
	"look_for_this" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"verified_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"trust_class" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"edited_by" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"placeholder" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_records" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"route" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"source_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"visibility" text NOT NULL,
	"guest_scope" text,
	"event_scope" text,
	"verified_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"trust_class" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"record_ref" jsonb NOT NULL,
	"terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "adventure_memories_slug_idx" ON "adventure_memories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "adventure_memories_place_idx" ON "adventure_memories" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "content_revisions_record_idx" ON "content_revisions" USING btree ("table_name","record_id","content_version");--> statement-breakpoint
CREATE UNIQUE INDEX "faq_entries_slug_idx" ON "faq_entries" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "itinerary_templates_slug_idx" ON "itinerary_templates" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "itinerary_templates_bucket_idx" ON "itinerary_templates" USING btree ("bucket");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_fields_key_idx" ON "operational_fields" USING btree ("key");--> statement-breakpoint
CREATE INDEX "operational_fields_kind_idx" ON "operational_fields" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "places_slug_idx" ON "places" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendations_slug_idx" ON "recommendations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "recommendations_experience_idx" ON "recommendations" USING btree ("experience_id");--> statement-breakpoint
CREATE INDEX "recommendations_category_idx" ON "recommendations" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "story_sections_slug_idx" ON "story_sections" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "story_sections_order_idx" ON "story_sections" USING btree ("order");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_facts_slug_idx" ON "venue_facts" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_spaces_slug_idx" ON "venue_spaces" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "knowledge_records_visibility_idx" ON "knowledge_records" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "knowledge_records_kind_idx" ON "knowledge_records" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "knowledge_records_route_idx" ON "knowledge_records" USING btree ("route");