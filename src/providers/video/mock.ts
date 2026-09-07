import type { ProviderFailure } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import { failure, fnv1a, okConfig, upHealth } from '../base';
import type { StorageProvider } from '../storage/types';
import { placeholderPosterPng } from './placeholder';
import type { PosterFrame, VideoAsset, VideoProbe, VideoProvider } from './types';

const g = globalThis as unknown as { __weddingMockVideo?: Map<string, VideoAsset> };
const assets = (): Map<string, VideoAsset> => (g.__weddingMockVideo ??= new Map());

/**
 * Mock: "transcodes" instantly; playback is a signed read URL of the (stripped) object; posters are
 * a generated placeholder frame; probing knows nothing (the pipeline reads MP4 headers itself).
 */
export class MockVideo implements VideoProvider {
  readonly kind = 'video' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { createAsset: true, getPlayback: true, hls: false, poster: false, probe: false };
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

  async extractPoster(_input: { bytes: Uint8Array; contentType: string; atSeconds?: number }): Promise<Result<PosterFrame, ProviderFailure>> {
    return ok({ bytes: placeholderPosterPng(), contentType: 'image/png', placeholder: true });
  }

  async probe(_input: { bytes: Uint8Array; contentType: string }): Promise<Result<VideoProbe, ProviderFailure>> {
    return ok({});
  }

  /** Tests only. */
  static reset() {
    assets().clear();
  }
}
