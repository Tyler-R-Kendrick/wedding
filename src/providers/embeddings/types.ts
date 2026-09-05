import type { ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';

export interface EmbeddingBatch {
  vectors: number[][];
  dims: number;
  model: string;
}

export interface EmbeddingsProvider extends ProviderDescriptor {
  kind: 'embeddings';
  readonly dims: number;
  readonly model: string;
  embed(texts: string[]): Promise<Result<EmbeddingBatch, ProviderFailure>>;
}
