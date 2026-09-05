import type { Db } from '@/db/client';
import { InMemoryCosineIndex } from './memory';
import { PgVectorIndex } from './pgvector';
import type { VectorIndexProvider } from './types';

export * from './types';
export { InMemoryCosineIndex } from './memory';
export { PgVectorIndex } from './pgvector';

/** pgvector when the extension loaded, else the in-memory index. `dims` must match the embeddings provider. */
export function createVectorIndexProvider(deps: { dims: number; db?: Pick<Db, 'vectorAvailable'> & Db; forceMock?: boolean }): VectorIndexProvider {
  if (!deps.forceMock && deps.db?.vectorAvailable) return new PgVectorIndex(deps.db, deps.dims);
  return new InMemoryCosineIndex(deps.dims);
}
