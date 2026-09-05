import { describe, expect, it } from 'vitest';
import type { Db } from '@/db/client';
import { hashedEmbedding, MOCK_EMBEDDING_DIMS } from '@/providers/embeddings';
import { cosine, createVectorIndexProvider, InMemoryCosineIndex, matchesFilter, PgVectorIndex } from '@/providers/vector-index';

const vec = (t: string) => hashedEmbedding(t, MOCK_EMBEDDING_DIMS);

describe('vector index seam: provider selection', () => {
  it('uses pgvector when the database has the extension, and the in-memory index otherwise', () => {
    const withVector = { vectorAvailable: true, execute: async () => [] } as unknown as Db;
    const withoutVector = { vectorAvailable: false, execute: async () => [] } as unknown as Db;
    expect(createVectorIndexProvider({ dims: 8, db: withVector })).toBeInstanceOf(PgVectorIndex);
    expect(createVectorIndexProvider({ dims: 8, db: withoutVector })).toBeInstanceOf(InMemoryCosineIndex);
    // No database at all (and the forced-mock path used by tests) also falls back.
    expect(createVectorIndexProvider({ dims: 8 })).toBeInstanceOf(InMemoryCosineIndex);
    expect(createVectorIndexProvider({ dims: 8, db: withVector, forceMock: true })).toBeInstanceOf(InMemoryCosineIndex);
  });

  it('reports its dimensions so the embeddings provider and the index cannot drift apart', () => {
    expect(createVectorIndexProvider({ dims: MOCK_EMBEDDING_DIMS }).dims).toBe(MOCK_EMBEDDING_DIMS);
  });
});

describe('in-memory cosine fallback', () => {
  const index = () => new InMemoryCosineIndex(MOCK_EMBEDDING_DIMS, { shared: false });

  it('ranks by cosine similarity and honours k', async () => {
    const idx = index();
    await idx.upsert('media', [
      { id: 'dance', vector: vec('dancing under string lights'), metadata: { published: true } },
      { id: 'toast', vector: vec('a toast being raised at dinner'), metadata: { published: true } },
      { id: 'flight', vector: vec('a flight to chicago'), metadata: { published: true } },
    ]);
    const q = await idx.query('media', { vector: vec('dancing lights'), k: 2 });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.value).toHaveLength(2);
    expect(q.value[0]!.id).toBe('dance');
    expect(q.value[0]!.score).toBeGreaterThan(q.value[1]!.score);
  });

  it('pre-filters on metadata equality', async () => {
    const idx = index();
    await idx.upsert('media', [
      { id: 'a', vector: vec('one'), metadata: { published: true, kind: 'image' } },
      { id: 'b', vector: vec('one'), metadata: { published: false, kind: 'image' } },
      { id: 'c', vector: vec('one'), metadata: { published: true, kind: 'video' } },
    ]);
    const published = await idx.query('media', { vector: vec('one'), k: 10, filter: { published: true } });
    expect(published.ok && published.value.map((m) => m.id).sort()).toEqual(['a', 'c']);
    const videos = await idx.query('media', { vector: vec('one'), k: 10, filter: { published: true, kind: 'video' } });
    expect(videos.ok && videos.value.map((m) => m.id)).toEqual(['c']);
  });

  it('keeps namespaces apart and deletes only what it is asked to', async () => {
    const idx = index();
    await idx.upsert('media', [{ id: 'a', vector: vec('one') }]);
    await idx.upsert('other', [{ id: 'a', vector: vec('two') }]);
    expect((await idx.query('other', { vector: vec('one'), k: 5 })).ok).toBe(true);
    const deleted = await idx.delete('media', ['a', 'missing']);
    expect(deleted.ok && deleted.value.count).toBe(1);
    const after = await idx.query('media', { vector: vec('one'), k: 5 });
    expect(after.ok && after.value).toEqual([]);
    const still = await idx.query('other', { vector: vec('two'), k: 5 });
    expect(still.ok && still.value.map((m) => m.id)).toEqual(['a']);
  });

  it('refuses vectors of the wrong width instead of silently mis-scoring', async () => {
    const bad = await index().upsert('media', [{ id: 'a', vector: [1, 2, 3] }]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.class).toBe('bad_request');
  });
});

describe('pgvector adapter (SQL path, without the extension)', () => {
  /** A database whose every statement fails, i.e. pgvector missing: the adapter must degrade, not throw. */
  const brokenDb = { vectorAvailable: true, execute: async () => { throw new Error('type "vector" does not exist'); } } as unknown as Db;

  it('maps a missing extension to an honest provider failure on every operation', async () => {
    const idx = new PgVectorIndex(brokenDb, MOCK_EMBEDDING_DIMS);
    for (const r of [await idx.upsert('media', [{ id: 'a', vector: vec('x') }]), await idx.query('media', { vector: vec('x'), k: 1 }), await idx.delete('media', ['a'])]) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.class).toBe('server');
        expect(r.error.provider).toBe('pgvector');
      }
    }
    expect((await idx.health()).status).toBe('down');
  });

  it('short-circuits an empty delete without touching the database', async () => {
    const r = await new PgVectorIndex(brokenDb, MOCK_EMBEDDING_DIMS).delete('media', []);
    expect(r.ok && r.value.count).toBe(0);
  });

  it('refuses an unsafe table name at construction', () => {
    expect(() => new PgVectorIndex(brokenDb, 8, 'items; drop table media_assets')).toThrow(/invalid vector table name/);
  });
});

describe('cosine helper', () => {
  it('is 1 for identical vectors, 0 for orthogonal, and 0 for empty ones', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 10);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 10);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it('treats an absent filter as "everything" and an absent metadata bag as "nothing matches"', () => {
    expect(matchesFilter(undefined, undefined)).toBe(true);
    expect(matchesFilter({ a: 1 }, { a: 1 })).toBe(true);
    expect(matchesFilter({ a: 1 }, { a: 2 })).toBe(false);
    expect(matchesFilter(undefined, { a: 1 })).toBe(false);
  });
});
