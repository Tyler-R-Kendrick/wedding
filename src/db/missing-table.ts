/**
 * Postgres "undefined_table" (42P01) for one named table, however the driver wraps it (postgres-js,
 * PGlite, drizzle's DrizzleQueryError).
 *
 * Exists for one situation only: a deployment whose code is ahead of its database's migrations. A
 * Vercel preview reads the production database and never migrates it (scripts/deploy/migrate-on-deploy.mjs),
 * so a branch that adds a table runs against a database without it until it merges. Readers of that
 * table catch exactly this and degrade; every other failure still throws.
 */
export function isMissingTable(e: unknown, table: string): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 4; cur = (cur as { cause?: unknown }).cause, depth++) {
    const { code, message } = cur as { code?: unknown; message?: unknown };
    if (code === '42P01' && String(message ?? '').includes(table)) return true;
  }
  return false;
}
