import type { ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';

export type VectorMetadata = Record<string, string | number | boolean>;

export interface VectorItem {
  id: string;
  vector: number[];
  metadata?: VectorMetadata;
}

export interface VectorMatch {
  id: string;
  /** Cosine similarity in [-1, 1]; higher is closer. */
  score: number;
  metadata?: VectorMetadata;
}

export interface VectorQuery {
  vector: number[];
  k: number;
  /** Equality filter on metadata keys. */
  filter?: VectorMetadata;
}

export interface VectorIndexProvider extends ProviderDescriptor {
  kind: 'vector-index';
  readonly dims: number;
  upsert(namespace: string, items: VectorItem[]): Promise<Result<{ count: number }, ProviderFailure>>;
  query(namespace: string, q: VectorQuery): Promise<Result<VectorMatch[], ProviderFailure>>;
  delete(namespace: string, ids: string[]): Promise<Result<{ count: number }, ProviderFailure>>;
  /**
   * How many vectors a namespace holds. `delete` can only report "the ids I named are gone"; this
   * is how a deletion proof can say "and the namespace is empty" without assuming it.
   */
  count(namespace: string): Promise<Result<{ count: number }, ProviderFailure>>;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function matchesFilter(metadata: VectorMetadata | undefined, filter: VectorMetadata | undefined): boolean {
  if (!filter) return true;
  if (!metadata) return Object.keys(filter).length === 0;
  return Object.entries(filter).every(([k, v]) => metadata[k] === v);
}
