ALTER TABLE "auth_users" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "phone_number_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN "phone" text;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_phone_idx" ON "auth_users" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "guests_phone_idx" ON "guests" USING btree ("phone");