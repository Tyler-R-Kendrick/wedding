CREATE TABLE "transportation_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"entitlement_id" text NOT NULL,
	"guest_id" text NOT NULL,
	"household_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_name" text NOT NULL,
	"provider_ref" text,
	"redemption_kind" text DEFAULT 'none' NOT NULL,
	"secret_ciphertext" text,
	"secret_key_id" text,
	"expires_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"failure_reason" text,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transportation_entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"household_id" text NOT NULL,
	"program" text DEFAULT 'reception-ride-home' NOT NULL,
	"provider_program_ref" text,
	"amount_note" text,
	"validity_note" text,
	"geofence_note" text,
	"guest_is_minor" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"source_id" text,
	"verified_at" timestamp with time zone,
	"assigned_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transportation_manual_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"program" text NOT NULL,
	"code_ciphertext" text NOT NULL,
	"code_key_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"claim_id" text,
	"uploaded_by" jsonb NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gift_links" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"note" text,
	"url" text NOT NULL,
	"disclosure" text,
	"placeholder" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_id" text,
	"verified_at" timestamp with time zone,
	"updated_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation_venues" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"place_ref" text,
	"resy_slug" text,
	"open_table_id" text,
	"url" text,
	"note" text,
	"placeholder" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_id" text,
	"verified_at" timestamp with time zone,
	"updated_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_action_records" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"actor" jsonb NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"url_host" text,
	"surface" text NOT NULL,
	"request_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transportation_claims" ADD CONSTRAINT "transportation_claims_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transportation_claims" ADD CONSTRAINT "transportation_claims_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transportation_entitlements" ADD CONSTRAINT "transportation_entitlements_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transportation_entitlements" ADD CONSTRAINT "transportation_entitlements_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transportation_claims_entitlement_idx" ON "transportation_claims" USING btree ("entitlement_id");--> statement-breakpoint
CREATE INDEX "transportation_claims_guest_idx" ON "transportation_claims" USING btree ("guest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transportation_entitlements_guest_program_idx" ON "transportation_entitlements" USING btree ("guest_id","program");--> statement-breakpoint
CREATE INDEX "transportation_entitlements_household_idx" ON "transportation_entitlements" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transportation_manual_codes_hash_idx" ON "transportation_manual_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "transportation_manual_codes_claim_idx" ON "transportation_manual_codes" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "transportation_manual_codes_program_status_idx" ON "transportation_manual_codes" USING btree ("program","status");--> statement-breakpoint
CREATE INDEX "external_action_records_kind_at_idx" ON "external_action_records" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "external_action_records_target_idx" ON "external_action_records" USING btree ("target_type","target_id");