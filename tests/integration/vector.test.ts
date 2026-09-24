import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { hashedEmbedding } from '@/providers/embeddings';
import { createVectorIndexProvider, PgVectorIndex } from '@/providers/vector-index';

describe('vector index selection', () => {
  it('uses pgvector when available, otherwise the in-memory index', async () => {
    const db = await getDb();
    const idx = createVectorIndexProvider({ dims: 256, db });
    expect(idx.name).toBe(db.vectorAvailable ? 'pgvector' : 'memory');
    const [a, b, c] = ['dancing at the reception', 'reception dancing', 'flight to chicago'].map((t) => hashedEmbedding(t)) as [number[], number[], number[]];
    expect((await idx.upsert('it', [{ id: 'a', vector: a, metadata: { kind: 'photo' } }, { id: 'c', vector: c, metadata: { kind: 'flight' } }])).ok).toBe(true);
    const q = await idx.query('it', { vector: b, k: 1 });
    expect(q.ok && q.value[0]?.id).toBe('a');
    const filtered = await idx.query('it', { vector: b, k: 5, filter: { kind: 'flight' } });
    expect(filtered.ok && filtered.value.map((m) => m.id)).toEqual(['c']);
    expect((await idx.delete('it', ['a', 'c'])).ok).toBe(true);
    if (db.vectorAvailable) expect(idx).toBeInstanceOf(PgVectorIndex);
  });

  it('rebuilds a table left at another embeddings model\'s width, and keeps one that fits', async () => {
    const db = await getDb();
    expect(db.vectorAvailable, 'the test database loads pgvector').toBe(true);
    // As a deployment that once ran hosted embeddings left it: 1024 dimensions, not the 256 now written.
    await db.execute(sql.raw('DROP TABLE IF EXISTS vector_width_it'));
    await db.execute(sql.raw('CREATE TABLE vector_width_it (namespace text NOT NULL, id text NOT NULL, embedding vector(1024) NOT NULL, metadata jsonb, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (namespace, id))'));
    const v = hashedEmbedding('dancing at the reception');
    const idx = new PgVectorIndex(db, 256, 'vector_width_it');
    expect((await idx.upsert('it', [{ id: 'a', vector: v }])).ok).toBe(true);
    const found = await idx.query('it', { vector: v, k: 1 });
    expect(found.ok && found.value[0]?.id).toBe('a');
    // The same width is left alone: a second index over it still finds what the first wrote.
    const again = await new PgVectorIndex(db, 256, 'vector_width_it').query('it', { vector: v, k: 1 });
    expect(again.ok && again.value[0]?.id).toBe('a');
    await db.execute(sql.raw('DROP TABLE vector_width_it'));
  });
});
