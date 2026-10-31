CREATE TABLE "guest_sign_in_passes" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"guest_id" text NOT NULL,
	"code_ciphertext" text NOT NULL,
	"code_key_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" jsonb,
	"issued_by" jsonb NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_sign_in_passes" ADD CONSTRAINT "guest_sign_in_passes_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_sign_in_passes_slug_idx" ON "guest_sign_in_passes" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "guest_sign_in_passes_guest_idx" ON "guest_sign_in_passes" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "guest_sign_in_passes_expires_idx" ON "guest_sign_in_passes" USING btree ("expires_at");