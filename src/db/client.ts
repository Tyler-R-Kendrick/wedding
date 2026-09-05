import 'server-only';
import type { Extension } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import * as schema from './schema';
import { runMigrations } from './migrate';
import { seed } from './seed/seed';

export type DbDriver = 'pglite' | 'postgres';

/**
 * The application database handle. Same drizzle API for both drivers:
 *  - DATABASE_URL set  -> postgres-js (production / staging)
 *  - otherwise         -> PGlite (memory:// in tests or with PGLITE_MEMORY=1, else ./.data/pglite)
 * `vectorAvailable` reports whether the pgvector extension loaded; vector features fall back when false.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema> & {
  readonly driver: DbDriver;
  readonly vectorAvailable: boolean;
  close(): Promise<void>;
};

type Holder = { promise?: Promise<Db> };
const g = globalThis as unknown as { __weddingDb?: Holder };
const holder: Holder = g.__weddingDb ?? (g.__weddingDb = {});

/** Lazily connects (and in dev/test migrates) once per process; survives Next.js HMR. */
export function getDb(): Promise<Db> {
  holder.promise ??= connect().catch((e) => {
    holder.promise = undefined;
    throw e;
  });
  return holder.promise;
}

/** Close and forget the current connection (tests, graceful shutdown). */
export async function resetDb(): Promise<void> {
  const p = holder.promise;
  holder.promise = undefined;
  if (!p) return;
  try {
    const db = await p;
    await db.close();
  } catch {
    // already failed to connect
  }
}

async function connect(): Promise<Db> {
  const db = env.DATABASE_URL ? await connectPostgres(env.DATABASE_URL) : await connectPglite();
  if (env.DB_AUTO_MIGRATE ?? !env.isProduction) {
    await runMigrations(db);
    if (env.DB_AUTO_SEED ?? !env.isProduction) await seed(db);
  }
  logger.info({ driver: db.driver, vector: db.vectorAvailable }, 'database ready');
  return db;
}

async function connectPglite(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const dataDir = env.isTest || env.PGLITE_MEMORY ? 'memory://' : env.PGLITE_DATA_DIR;
  const vector = await loadPgVector();
  const client = await PGlite.create({ dataDir, ...(vector ? { extensions: { vector } } : {}) });
  const base = drizzle({ client, schema });
  let vectorAvailable = false;
  if (vector) {
    try {
      await base.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
      vectorAvailable = true;
    } catch (e) {
      logger.warn({ err: e }, 'pgvector extension could not be enabled in PGlite; vector index falls back to memory');
    }
  }
  return Object.assign(base, { driver: 'pglite' as const, vectorAvailable, close: () => client.close() }) as unknown as Db;
}

async function connectPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const client = postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 10 });
  const base = drizzle({ client, schema });
  let vectorAvailable = false;
  try {
    await base.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    vectorAvailable = true;
  } catch {
    try {
      const rows = await base.execute(sql`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
      vectorAvailable = Array.isArray(rows) ? rows.length > 0 : ((rows as { rows?: unknown[] }).rows?.length ?? 0) > 0;
    } catch {
      vectorAvailable = false;
    }
  }
  return Object.assign(base, { driver: 'postgres' as const, vectorAvailable, close: () => client.end({ timeout: 5 }) }) as unknown as Db;
}

/** The standalone pgvector build for PGlite. When it fails to load, vector features fall back. */
async function loadPgVector(): Promise<Extension | undefined> {
  try {
    const mod = (await import('@electric-sql/pglite-pgvector')) as { vector?: Extension; default?: { vector?: Extension } };
    return mod.vector ?? mod.default?.vector;
  } catch (e) {
    logger.debug({ err: e }, '@electric-sql/pglite-pgvector unavailable');
    return undefined;
  }
}

export { schema };
