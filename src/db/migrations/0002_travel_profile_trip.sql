CREATE TABLE "guest_itinerary_items" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"household_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"title" text NOT NULL,
	"provider" text,
	"provider_ref" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confirmed_via" text,
	"confirmed_at" timestamp with time zone,
	"created_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_travel_profiles" (
	"guest_id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"home_city" text,
	"home_region" text,
	"preferred_airport" text,
	"alternate_airports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"adults" integer DEFAULT 1 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"airline_preference" text,
	"nonstop_preferred" boolean DEFAULT false NOT NULL,
	"cabin" text DEFAULT 'economy' NOT NULL,
	"arrive_earliest" date,
	"arrive_latest" date,
	"depart_earliest" date,
	"depart_latest" date,
	"consented_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hotel_recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"is_venue" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_band" text,
	"walk_minutes_to_venue" integer,
	"website_url" text,
	"booking_url" text,
	"block" jsonb,
	"placeholder" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"source_id" text,
	"verified_at" timestamp with time zone NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"updated_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travel_links" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"updated_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "guest_itinerary_items_guest_idx" ON "guest_itinerary_items" USING btree ("guest_id","start_at");--> statement-breakpoint
CREATE INDEX "guest_itinerary_items_household_idx" ON "guest_itinerary_items" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "guest_itinerary_items_provider_ref_idx" ON "guest_itinerary_items" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX "guest_travel_profiles_household_idx" ON "guest_travel_profiles" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "hotel_recommendations_order_idx" ON "hotel_recommendations" USING btree ("active","sort_order");--> statement-breakpoint
CREATE INDEX "travel_links_order_idx" ON "travel_links" USING btree ("active","category","sort_order");