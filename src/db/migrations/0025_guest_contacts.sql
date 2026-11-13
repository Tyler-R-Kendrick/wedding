CREATE TABLE IF NOT EXISTS "guest_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_contacts" ADD CONSTRAINT "guest_contacts_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "guest_contacts_kind_value_idx" ON "guest_contacts" USING btree ("kind","value");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guest_contacts_guest_idx" ON "guest_contacts" USING btree ("guest_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guest_contacts_value_idx" ON "guest_contacts" USING btree ("value");
--> statement-breakpoint
INSERT INTO guest_contacts (id, guest_id, kind, value, label, is_primary, created_at, updated_at)
SELECT
  'gc_' || substr(md5(g.id || ':email:' || g.email), 1, 24),
  g.id,
  'email',
  lower(trim(g.email)),
  NULL,
  true,
  g.created_at,
  g.updated_at
FROM guests g
WHERE g.email IS NOT NULL
  AND g.merged_into_guest_id IS NULL
  AND trim(g.email) <> ''
ON CONFLICT ("kind", "value") DO NOTHING;
--> statement-breakpoint
INSERT INTO guest_contacts (id, guest_id, kind, value, label, is_primary, created_at, updated_at)
SELECT
  'gc_' || substr(md5(g.id || ':phone:' || g.phone), 1, 24),
  g.id,
  'phone',
  g.phone,
  NULL,
  true,
  g.created_at,
  g.updated_at
FROM guests g
WHERE g.phone IS NOT NULL
  AND g.merged_into_guest_id IS NULL
  AND trim(g.phone) <> ''
ON CONFLICT ("kind", "value") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "guest_contacts" ENABLE ROW LEVEL SECURITY;
