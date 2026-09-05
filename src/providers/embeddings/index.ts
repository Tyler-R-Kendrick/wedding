import type { ServerEnv } from '@/lib/env';
import { AiSdkEmbeddings } from './ai-sdk';
import { MockEmbeddings } from './mock';
import type { EmbeddingsProvider } from './types';

export * from './types';
export { MockEmbeddings, hashedEmbedding, MOCK_EMBEDDING_DIMS } from './mock';
export { AiSdkEmbeddings } from './ai-sdk';

export function createEmbeddingsProvider(env: Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'OPENAI_API_KEY' | 'VOYAGE_API_KEY' | 'EMBEDDINGS_PROVIDER'>): EmbeddingsProvider {
  if (env.FORCE_MOCK_PROVIDERS) return new MockEmbeddings();
  const preferred = env.EMBEDDINGS_PROVIDER;
  if ((preferred === 'voyage' || !preferred) && env.VOYAGE_API_KEY) return new AiSdkEmbeddings('voyage', env.VOYAGE_API_KEY);
  if ((preferred === 'openai' || !preferred) && env.OPENAI_API_KEY) return new AiSdkEmbeddings('openai', env.OPENAI_API_KEY);
  return new MockEmbeddings();
}
