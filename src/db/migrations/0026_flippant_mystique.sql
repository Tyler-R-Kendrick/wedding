-- Better Auth 1.7.7+ no longer writes auth_accounts.issuer; align provider_id with the legacy
-- column, then ensure (provider_id, account_id) is unique before swapping indexes.
UPDATE "auth_accounts"
SET "provider_id" = "issuer"
WHERE "provider_id" IS DISTINCT FROM "issuer";
--> statement-breakpoint
WITH ranked AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "provider_id", "account_id"
			ORDER BY "updated_at" DESC, "created_at" DESC, "id" ASC
		) AS rn
	FROM "auth_accounts"
)
UPDATE "auth_accounts" AS a
SET
	"account_id" = a."account_id" || '#legacy-' || a."id",
	"updated_at" = NOW()
FROM ranked AS r
WHERE a."id" = r."id"
	AND r.rn > 1;
--> statement-breakpoint
DROP INDEX "auth_accounts_issuer_account_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_provider_account_idx" ON "auth_accounts" USING btree ("provider_id", "account_id");
--> statement-breakpoint
ALTER TABLE "auth_accounts" DROP COLUMN "issuer";
