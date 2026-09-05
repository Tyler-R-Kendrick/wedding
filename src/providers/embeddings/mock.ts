import { ok } from '@/contracts/result';
import { fnv1a, okConfig, upHealth } from '../base';
import type { EmbeddingsProvider } from './types';

export const MOCK_EMBEDDING_DIMS = 256;

/** Hashed bag-of-words vectors: deterministic, cheap, and similar texts stay close. */
export function hashedEmbedding(text: string, dims = MOCK_EMBEDDING_DIMS): number[] {
  const v = new Array<number>(dims).fill(0);
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const w of words) {
    const h = fnv1a(w);
    const idx = h % dims;
    const sign = (h >>> 16) & 1 ? 1 : -1;
    v[idx] = (v[idx] ?? 0) + sign;
    const h2 = fnv1a(`${w}#2`);
    const idx2 = h2 % dims;
    v[idx2] = (v[idx2] ?? 0) + ((h2 >>> 8) & 1 ? 0.5 : -0.5);
  }
  let norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm === 0) {
    v[fnv1a(text) % dims] = 1;
    norm = 1;
  }
  return v.map((x) => x / norm);
}

export class MockEmbeddings implements EmbeddingsProvider {
  readonly kind = 'embeddings' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { embed: true };
  readonly dims = MOCK_EMBEDDING_DIMS;
  readonly model = 'mock-hash-256';
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }
  async embed(texts: string[]) {
    return ok({ vectors: texts.map((t) => hashedEmbedding(t, this.dims)), dims: this.dims, model: this.model });
  }
}
