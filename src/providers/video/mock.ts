import { err, ok } from '@/contracts/result';
import { failure, fnv1a, okConfig, upHealth } from '../base';
import type { StorageProvider } from '../storage/types';
import type { VideoAsset, VideoProvider } from './types';

const g = globalThis as unknown as { __weddingMockVideo?: Map<string, VideoAsset> };
const assets = (): Map<string, VideoAsset> => (g.__weddingMockVideo ??= new Map());

/** Mock: "transcodes" instantly; playback is a signed read URL of the original object. */
export class MockVideo implements VideoProvider {
  readonly kind = 'video' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { createAsset: true, getPlayback: true, hls: false };
  constructor(private readonly storage: StorageProvider) {}

  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }

  async createAsset(input: { objectKey: string }) {
    const assetId = `mock_${fnv1a(input.objectKey).toString(16).padStart(8, '0')}`;
    const asset: VideoAsset = { assetId, status: 'ready', sourceKey: input.objectKey };
    assets().set(assetId, asset);
    return ok(asset);
  }

  async getPlayback(assetId: string) {
    const asset = assets().get(assetId);
    if (!asset) return err(failure(this.name, 'not_found', 'Video not found.'));
    const signed = await this.storage.createSignedReadUrl({ key: asset.sourceKey, expiresInSeconds: 3600 });
    if (!signed.ok) return err(signed.error);
    return ok({ assetId, status: asset.status, playbackUrl: signed.value.url, expiresInSeconds: 3600 });
  }

  /** Tests only. */
  static reset() {
    assets().clear();
  }
}
