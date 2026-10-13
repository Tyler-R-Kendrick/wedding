import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';

const EXPECTED_TABLES = ['audit_events', 'content_sources', 'feature_flags', 'idempotency_keys', 'jobs', 'lifecycle_state', 'metrics', 'rate_limits', 'site_settings'];

describe('migrations', () => {
  it('apply cleanly on a fresh PGlite database and are idempotent', async () => {
    const db = await getDb();
    expect(db.driver).toBe('pglite');
    const result = await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`);
    const rows = (Array.isArray(result) ? result : (result as { rows: { table_name: string }[] }).rows) as { table_name: string }[];
    const names = rows.map((r) => r.table_name);
    for (const t of EXPECTED_TABLES) expect(names, t).toContain(t);
    await expect(runMigrations(db)).resolves.toBeUndefined();
  });

  it('reports whether pgvector loaded', async () => {
    const db = await getDb();
    expect(typeof db.vectorAvailable).toBe('boolean');
  });

  it('enables row level security on every public application table', async () => {
    const db = await getDb();
    const result = await db.execute(sql`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
      ORDER BY c.relname
    `);
    const rows = (Array.isArray(result) ? result : (result as { rows: { table_name: string; rls_enabled: boolean }[] }).rows) as {
      table_name: string;
      rls_enabled: boolean;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    const without = rows.filter((r) => !r.rls_enabled).map((r) => r.table_name);
    expect(without, `tables missing RLS: ${without.join(', ')}`).toEqual([]);
  });
});
