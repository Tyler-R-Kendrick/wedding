import { err, ok } from '@/contracts/result';
import { failure, okConfig, upHealth } from '../base';
import type { EmbeddingsProvider } from './types';

export type EmbeddingVendor = 'openai' | 'voyage';

const MODELS: Record<EmbeddingVendor, { model: string; dims: number }> = {
  openai: { model: 'text-embedding-3-small', dims: 1536 },
  voyage: { model: 'voyage-3.5-lite', dims: 1024 },
};

/** Real embeddings through the Vercel AI SDK (`embedMany`). Loaded lazily. */
export class AiSdkEmbeddings implements EmbeddingsProvider {
  readonly kind = 'embeddings' as const;
  readonly name: string;
  readonly mode = 'live' as const;
  readonly capabilities = { embed: true };
  readonly dims: number;
  readonly model: string;

  constructor(private readonly vendor: EmbeddingVendor, private readonly apiKey: string) {
    this.name = vendor;
    this.model = MODELS[vendor].model;
    this.dims = MODELS[vendor].dims;
  }

  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth(this.model);
  }

  private async modelInstance() {
    if (this.vendor === 'openai') {
      const { createOpenAI } = await import('@ai-sdk/openai');
      return createOpenAI({ apiKey: this.apiKey }).textEmbeddingModel(this.model);
    }
    const { createVoyage } = await import('@ai-sdk/voyage');
    return createVoyage({ apiKey: this.apiKey }).textEmbeddingModel(this.model);
  }

  async embed(texts: string[]) {
    if (texts.length === 0) return ok({ vectors: [], dims: this.dims, model: this.model });
    try {
      const { embedMany } = await import('ai');
      const { embeddings } = await embedMany({ model: await this.modelInstance(), values: texts, abortSignal: AbortSignal.timeout(15_000) });
      return ok({ vectors: embeddings, dims: this.dims, model: this.model });
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      const cls = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'server';
      return err(failure(this.name, cls, 'Search is not available right now.', { raw: e }));
    }
  }
}
