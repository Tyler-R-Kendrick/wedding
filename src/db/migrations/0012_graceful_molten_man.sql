CREATE TABLE "timeline_moments" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"chapter" text NOT NULL,
	"order" integer NOT NULL,
	"title" text NOT NULL,
	"occurred_on" text,
	"location_label" text,
	"note" text NOT NULL,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"adventure_slug" text,
	"external_ref" text,
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
CREATE UNIQUE INDEX "timeline_moments_slug_idx" ON "timeline_moments" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "timeline_moments_order_idx" ON "timeline_moments" USING btree ("order");--> statement-breakpoint
CREATE UNIQUE INDEX "timeline_moments_external_ref_idx" ON "timeline_moments" USING btree ("external_ref");