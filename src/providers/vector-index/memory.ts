import { err, ok } from '@/contracts/result';
import { failure, okConfig, upHealth } from '../base';
import { cosine, matchesFilter, type VectorIndexProvider, type VectorItem, type VectorQuery } from './types';

const g = globalThis as unknown as { __weddingVectorIndex?: Map<string, Map<string, VectorItem>> };

/** Always available. Fine for a few thousand vectors; the pgvector index takes over when present. */
export class InMemoryCosineIndex implements VectorIndexProvider {
  readonly kind = 'vector-index' as const;
  readonly name = 'memory';
  readonly mode = 'mock' as const;
  readonly capabilities = { upsert: true, query: true, delete: true, persistent: false };
  private readonly store: Map<string, Map<string, VectorItem>>;

  constructor(readonly dims: number, opts: { shared?: boolean } = {}) {
    this.store = opts.shared === false ? new Map() : (g.__weddingVectorIndex ??= new Map());
  }

  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth(`${this.store.size} namespaces`);
  }

  private ns(namespace: string) {
    let m = this.store.get(namespace);
    if (!m) {
      m = new Map();
      this.store.set(namespace, m);
    }
    return m;
  }

  async upsert(namespace: string, items: VectorItem[]) {
    const m = this.ns(namespace);
    for (const item of items) {
      if (item.vector.length !== this.dims) return err(failure(this.name, 'bad_request', 'Vector has the wrong number of dimensions.'));
      m.set(item.id, { ...item });
    }
    return ok({ count: items.length });
  }

  async query(namespace: string, q: VectorQuery) {
    const m = this.ns(namespace);
    const scored = [];
    for (const item of m.values()) {
      if (!matchesFilter(item.metadata, q.filter)) continue;
      scored.push({ id: item.id, score: cosine(q.vector, item.vector), metadata: item.metadata });
    }
    scored.sort((a, b) => b.score - a.score);
    return ok(scored.slice(0, Math.max(0, q.k)));
  }

  async delete(namespace: string, ids: string[]) {
    const m = this.ns(namespace);
    let count = 0;
    for (const id of ids) if (m.delete(id)) count++;
    return ok({ count });
  }

  clear() {
    this.store.clear();
  }
}
