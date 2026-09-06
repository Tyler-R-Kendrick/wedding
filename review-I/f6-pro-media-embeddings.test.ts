import { beforeAll, describe, expect, it } from 'vitest';

import { getDb } from '@/db/client';
import { MockEmbeddings } from '@/providers/embeddings';
import type { EmbeddingsProvider } from '@/providers/embeddings/types';
import type { MediaAiProvider, MediaRef } from '@/providers/media-ai/types';
import { setProviderOverride } from '@/providers/registry';
import { indexAsset, indexerDeps } from '@/domain/mediaai';
import { buildRig, type Rig } from './harness';

/**
 * FINDING 6 — professional media without written confirmation is still described to a
 * third-party AI service, in text.
 *
 * `indexAsset` refuses to hand the IMAGE to the captioning provider without the
 * PRO_MEDIA_AI_PROCESSING gate — correct — and the code comment on that branch says
 * "Metadata-only: nothing is sent anywhere" (src/domain/mediaai/indexer.ts:136). It then falls
 * through to `deps.embeddings.embed([indexText])` (indexer.ts:169-170) unconditionally, and
 * `indexText` contains the photographer's vendor name plus the caption and album written for
 * their delivery (src/domain/mediaai/text.ts:155-168). With VOYAGE_API_KEY or OPENAI_API_KEY set,
 * `createEmbeddingsProvider` (src/providers/embeddings/index.ts:13-14) is a live third-party API.
 */
class SpyEmbeddings implements EmbeddingsProvider {
  readonly kind = 'embeddings' as const;
  readonly name = 'spy';
  readonly mode = 'mock' as const;
  readonly capabilities = { embed: true };
  readonly dims: number;
  readonly model: string;
  readonly sent: string[] = [];
  constructor(private readonly inner = new MockEmbeddings()) {
    this.dims = inner.dims;
    this.model = inner.model;
  }
  validateConfig() { return this.inner.validateConfig(); }
  health() { return this.inner.health(); }
  embed(texts: string[]) { this.sent.push(...texts); return this.inner.embed(texts); }
}

class RefusingMediaAi implements MediaAiProvider {
  readonly kind = 'media-ai' as const;
  readonly name = 'refusing';
  readonly mode = 'mock' as const;
  readonly capabilities = { caption: true, describeScenes: true, tags: true, annotate: true };
  readonly calls: string[] = [];
  validateConfig() { return { ok: true, missing: [], warnings: [] }; }
  async health() { return { status: 'up' as const, checkedAt: new Date().toISOString() }; }
  async annotate(m: MediaRef): Promise<never> { this.calls.push(m.objectKey); throw new Error('media-ai must never be called for unconfirmed professional media'); }
  async caption(m: MediaRef): Promise<never> { this.calls.push(m.objectKey); throw new Error('no'); }
  async tags(m: MediaRef): Promise<never> { this.calls.push(m.objectKey); throw new Error('no'); }
  async describeScenes(m: MediaRef): Promise<never> { this.calls.push(m.objectKey); throw new Error('no'); }
}

describe('F6: unconfirmed professional media still reaches an external embeddings provider', () => {
  let rig: Rig;
  const embeddings = new SpyEmbeddings();
  const mediaAi = new RefusingMediaAi();

  beforeAll(async () => {
    rig = await buildRig();
    setProviderOverride('embeddings', embeddings);
    setProviderOverride('media-ai', mediaAi);
    delete process.env.FLAG_PRO_MEDIA_AI_PROCESSING; // the shipping default: off
  });

  it('the image never leaves, but the photographer-attributed text does', async () => {
    const db = await getDb();
    const pro = rig.corpus.get('pro')!;
    const outcome = await indexAsset(indexerDeps(db), pro.assetId);
    console.info('[F6] index outcome=%s mediaAiCalls=%d embeddingsTexts=%s', JSON.stringify(outcome), mediaAi.calls.length, JSON.stringify(embeddings.sent));

    // The vision provider is correctly never called.
    expect(mediaAi.calls, 'the photographer\'s image must never reach the captioning provider').toHaveLength(0);

    // But the text describing it is embedded by a provider that is a live API when a key is set.
    const proText = embeddings.sent.filter((t) => t.includes('Brooke Alaina Photography'));
    expect(proText, 'nothing derived from unconfirmed professional media should be sent to an external provider').toHaveLength(0);
  });
});
