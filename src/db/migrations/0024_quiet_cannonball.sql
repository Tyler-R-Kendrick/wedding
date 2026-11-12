CREATE TABLE "guest_trip_preferences" (
	"guest_id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"prefs" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_trip_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "price_level" integer;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "hours" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "hours_note" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "reservations" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "diets" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "step_free" boolean;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "setting" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "min_age" integer;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "fact_sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "facts_checked_at" text;--> statement-breakpoint
ALTER TABLE "guest_trip_preferences" ADD CONSTRAINT "guest_trip_preferences_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_trip_preferences" ADD CONSTRAINT "guest_trip_preferences_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_trip_preferences_household_idx" ON "guest_trip_preferences" USING btree ("household_id");