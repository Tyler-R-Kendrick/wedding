import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` needs no database. `db:migrate` runs src/db/migrate.ts
// against DATABASE_URL (postgres) or the local PGlite directory.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/wedding' },
  strict: true,
  verbose: false,
});
