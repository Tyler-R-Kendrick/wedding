CREATE TABLE "ai_answer_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"answer_id" text NOT NULL,
	"marker" text NOT NULL,
	"source_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"verified_at" timestamp with time zone,
	"record_ref" jsonb,
	"trust_class" text NOT NULL,
	"retrieved_at" timestamp with time zone,
	"cited" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"request_id" text NOT NULL,
	"principal_key" text NOT NULL,
	"principal_kind" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"status" text NOT NULL,
	"intent" text NOT NULL,
	"tools_selected" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_id" text NOT NULL,
	"verifier" jsonb NOT NULL,
	"security_alerts" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_key" text NOT NULL,
	"principal_kind" text NOT NULL,
	"surface" text DEFAULT 'ai' NOT NULL,
	"turns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_invocations" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"answer_id" text,
	"request_id" text NOT NULL,
	"capability" text NOT NULL,
	"kind" text NOT NULL,
	"surface" text NOT NULL,
	"selected_by" text NOT NULL,
	"outcome" text NOT NULL,
	"error_code" text,
	"input_hash" text,
	"output_chars" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_answer_sources" ADD CONSTRAINT "ai_answer_sources_answer_id_ai_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."ai_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_answers" ADD CONSTRAINT "ai_answers_session_id_ai_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_invocations" ADD CONSTRAINT "capability_invocations_session_id_ai_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_invocations" ADD CONSTRAINT "capability_invocations_answer_id_ai_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."ai_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_answer_sources_answer_idx" ON "ai_answer_sources" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "ai_answers_created_idx" ON "ai_answers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_answers_status_idx" ON "ai_answers" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ai_answers_session_idx" ON "ai_answers" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "ai_sessions_expires_idx" ON "ai_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ai_sessions_principal_idx" ON "ai_sessions" USING btree ("principal_key","last_active_at");--> statement-breakpoint
CREATE INDEX "capability_invocations_at_idx" ON "capability_invocations" USING btree ("at");--> statement-breakpoint
CREATE INDEX "capability_invocations_capability_idx" ON "capability_invocations" USING btree ("capability","at");