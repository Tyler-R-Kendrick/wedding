DROP INDEX "auth_accounts_issuer_account_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_provider_account_idx" ON "auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
ALTER TABLE "auth_accounts" DROP COLUMN "issuer";