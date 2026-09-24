import { MockEmbeddings } from './mock';
import type { EmbeddingsProvider } from './types';

export * from './types';
export { MockEmbeddings, hashedEmbedding, MOCK_EMBEDDING_DIMS } from './mock';

/**
 * Hashed bag-of-words vectors, computed in-process. No hosted embeddings API (Voyage, OpenAI or
 * anything behind a gateway) is ever called: retrieval for the concierge and media search works
 * from the site's own words, so no key is needed and nothing is sent anywhere to be embedded.
 */
export function createEmbeddingsProvider(): EmbeddingsProvider {
  return new MockEmbeddings();
}
