CREATE TABLE "visit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"source" text DEFAULT 'client' NOT NULL,
	"path" text NOT NULL,
	"name" text,
	"value" double precision,
	"message" text,
	"stack" text,
	"fingerprint" text
);
--> statement-breakpoint
CREATE TABLE "visit_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"principal_kind" text DEFAULT 'anonymous' NOT NULL,
	"guest_id" text,
	"device" text NOT NULL,
	"browser" text NOT NULL,
	"entry_path" text NOT NULL,
	"exit_path" text NOT NULL,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "visit_events_session_idx" ON "visit_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "visit_events_kind_at_idx" ON "visit_events" USING btree ("kind","at");--> statement-breakpoint
CREATE INDEX "visit_events_fingerprint_idx" ON "visit_events" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "visit_sessions_started_at_idx" ON "visit_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "visit_sessions_guest_idx" ON "visit_sessions" USING btree ("guest_id");--> statement-breakpoint
-- Supabase exposes the public schema over PostgREST; the site reads these tables only through its own server (0014).
ALTER TABLE "visit_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "visit_events" ENABLE ROW LEVEL SECURITY;
