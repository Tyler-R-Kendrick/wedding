CREATE TABLE "guest_sheet_copies" (
	"id" text PRIMARY KEY NOT NULL,
	"rows" jsonb NOT NULL,
	"withheld_columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text,
	"uploaded_by" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "guest_sheet_copies_uploaded_at_idx" ON "guest_sheet_copies" USING btree ("uploaded_at");