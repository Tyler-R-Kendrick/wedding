CREATE TABLE "guests" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"display_name" text NOT NULL,
	"email" text,
	"is_minor" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"manager_guest_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"event_id" text NOT NULL,
	"plus_one_policy" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"date_iso" date NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"venue_space_ref" text,
	"dress_code" text,
	"accessibility_note" text,
	"placeholder" boolean DEFAULT true NOT NULL,
	"rsvp_required" boolean DEFAULT true NOT NULL,
	"has_meal" boolean DEFAULT false NOT NULL,
	"meal_options_version" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_options" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"version" integer NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rsvp_settings" (
	"id" text PRIMARY KEY DEFAULT 'current' NOT NULL,
	"mode" text DEFAULT 'auto' NOT NULL,
	"deadline_at" timestamp with time zone,
	"note" text,
	"updated_by" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekend_notices" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_needs" (
	"guest_id" text PRIMARY KEY NOT NULL,
	"dietary" text,
	"accessibility" text,
	"updated_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rsvp_confirmation_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"recipient_guest_id" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rsvp_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"event_id" text NOT NULL,
	"status" text NOT NULL,
	"meal_option_id" text,
	"meal_options_version" integer,
	"plus_one_attending" boolean DEFAULT false NOT NULL,
	"plus_one_name" text,
	"plus_one_meal_option_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"submitted_by" jsonb NOT NULL,
	"submitted_via" text DEFAULT 'guest' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floor_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_space_ref" text NOT NULL,
	"name" text NOT NULL,
	"view_box" text NOT NULL,
	"outline" text NOT NULL,
	"anchors" jsonb NOT NULL,
	"placeholder" boolean DEFAULT true NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seat_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"guest_id" text NOT NULL,
	"seat_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seating_publications" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" jsonb NOT NULL,
	"unpublished_at" timestamp with time zone,
	"unpublished_by" jsonb,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "seating_tables" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"capacity" integer DEFAULT 10 NOT NULL,
	"floor_plan_id" text,
	"anchor_id" text,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_entitlements" ADD CONSTRAINT "event_entitlements_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_entitlements" ADD CONSTRAINT "event_entitlements_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_options" ADD CONSTRAINT "meal_options_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_needs" ADD CONSTRAINT "guest_needs_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_confirmation_emails" ADD CONSTRAINT "rsvp_confirmation_emails_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_confirmation_emails" ADD CONSTRAINT "rsvp_confirmation_emails_recipient_guest_id_guests_id_fk" FOREIGN KEY ("recipient_guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_responses" ADD CONSTRAINT "rsvp_responses_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_responses" ADD CONSTRAINT "rsvp_responses_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_responses" ADD CONSTRAINT "rsvp_responses_meal_option_id_meal_options_id_fk" FOREIGN KEY ("meal_option_id") REFERENCES "public"."meal_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_responses" ADD CONSTRAINT "rsvp_responses_plus_one_meal_option_id_meal_options_id_fk" FOREIGN KEY ("plus_one_meal_option_id") REFERENCES "public"."meal_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_table_id_seating_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."seating_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seating_tables" ADD CONSTRAINT "seating_tables_floor_plan_id_floor_plans_id_fk" FOREIGN KEY ("floor_plan_id") REFERENCES "public"."floor_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guests_household_idx" ON "guests" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_entitlements_guest_event_idx" ON "event_entitlements" USING btree ("guest_id","event_id");--> statement-breakpoint
CREATE INDEX "event_entitlements_event_idx" ON "event_entitlements" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_slug_idx" ON "events" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "meal_options_event_version_idx" ON "meal_options" USING btree ("event_id","version");--> statement-breakpoint
CREATE INDEX "weekend_notices_active_idx" ON "weekend_notices" USING btree ("active");--> statement-breakpoint
CREATE INDEX "rsvp_confirmation_emails_status_idx" ON "rsvp_confirmation_emails" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "rsvp_responses_guest_event_idx" ON "rsvp_responses" USING btree ("guest_id","event_id");--> statement-breakpoint
CREATE INDEX "rsvp_responses_event_idx" ON "rsvp_responses" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "floor_plans_space_idx" ON "floor_plans" USING btree ("venue_space_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "seat_assignments_guest_idx" ON "seat_assignments" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "seat_assignments_table_idx" ON "seat_assignments" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "seating_publications_published_at_idx" ON "seating_publications" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seating_tables_name_idx" ON "seating_tables" USING btree ("name");