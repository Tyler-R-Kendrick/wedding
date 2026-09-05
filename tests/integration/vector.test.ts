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
});
