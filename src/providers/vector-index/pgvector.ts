import { sql } from 'drizzle-orm';
import { err, ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { failure, okConfig, upHealth } from '../base';
import type { VectorIndexProvider, VectorItem, VectorMatch, VectorMetadata, VectorQuery } from './types';

/**
 * pgvector-backed index. Creates its own table lazily so the committed migrations never
 * depend on the extension; used only when `db.vectorAvailable`.
 */
export class PgVectorIndex implements VectorIndexProvider {
  readonly kind = 'vector-index' as const;
  readonly name = 'pgvector';
  readonly mode = 'live' as const;
  readonly capabilities = { upsert: true, query: true, delete: true, persistent: true };
  private ready?: Promise<void>;

  constructor(private readonly db: Db, readonly dims: number, private readonly table = 'vector_index_items') {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error('invalid vector table name');
  }

  validateConfig() {
    return okConfig();
  }
  async health() {
    try {
      await this.ensure();
      return upHealth(this.table);
    } catch (e) {
      return { status: 'down' as const, checkedAt: new Date().toISOString(), detail: e instanceof Error ? e.message : 'error' };
    }
  }

  private ensure() {
    this.ready ??= (async () => {
      await this.db.execute(sql.raw(
        `CREATE TABLE IF NOT EXISTS ${this.table} (
          namespace text NOT NULL,
          id text NOT NULL,
          embedding vector(${this.dims}) NOT NULL,
          metadata jsonb,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (namespace, id)
        )`,
      ));
    })();
    return this.ready;
  }

  private literal(vector: number[]): string {
    return `[${vector.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;
  }

  private rows<T>(result: unknown): T[] {
    if (Array.isArray(result)) return result as T[];
    return ((result as { rows?: T[] }).rows ?? []) as T[];
  }

  async upsert(namespace: string, items: VectorItem[]) {
    try {
      await this.ensure();
      for (const item of items) {
        if (item.vector.length !== this.dims) return err(failure(this.name, 'bad_request', 'Vector has the wrong number of dimensions.'));
        await this.db.execute(sql`
          INSERT INTO ${sql.raw(this.table)} (namespace, id, embedding, metadata, updated_at)
          VALUES (${namespace}, ${item.id}, ${this.literal(item.vector)}::vector, ${JSON.stringify(item.metadata ?? {})}::jsonb, now())
          ON CONFLICT (namespace, id) DO UPDATE SET embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata, updated_at = now()
        `);
      }
      return ok({ count: items.length });
    } catch (e) {
      return err(failure(this.name, 'server', 'Search index is not available right now.', { raw: e }));
    }
  }

  async query(namespace: string, q: VectorQuery) {
    try {
      await this.ensure();
      const filter = JSON.stringify(q.filter ?? {});
      const result = await this.db.execute(sql`
        SELECT id, metadata, 1 - (embedding <=> ${this.literal(q.vector)}::vector) AS score
        FROM ${sql.raw(this.table)}
        WHERE namespace = ${namespace} AND metadata @> ${filter}::jsonb
        ORDER BY embedding <=> ${this.literal(q.vector)}::vector
        LIMIT ${Math.max(0, q.k)}
      `);
      const rows = this.rows<{ id: string; metadata: VectorMetadata | string | null; score: number | string }>(result);
      const matches: VectorMatch[] = rows.map((r) => ({
        id: r.id,
        score: Number(r.score),
        metadata: (typeof r.metadata === 'string' ? (JSON.parse(r.metadata) as VectorMetadata) : r.metadata) ?? undefined,
      }));
      return ok(matches);
    } catch (e) {
      return err(failure(this.name, 'server', 'Search index is not available right now.', { raw: e }));
    }
  }

  async delete(namespace: string, ids: string[]) {
    if (ids.length === 0) return ok({ count: 0 });
    try {
      await this.ensure();
      const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
      const result = await this.db.execute(sql`
        DELETE FROM ${sql.raw(this.table)} WHERE namespace = ${namespace} AND id IN (${idList}) RETURNING id
      `);
      return ok({ count: this.rows(result).length });
    } catch (e) {
      return err(failure(this.name, 'server', 'Search index is not available right now.', { raw: e }));
    }
  }
}
