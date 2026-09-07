import type { ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';

export type VideoAssetStatus = 'preparing' | 'ready' | 'errored';

export interface VideoAsset {
  assetId: string;
  status: VideoAssetStatus;
  /** Storage key the asset was created from. */
  sourceKey: string;
}

export interface VideoPlayback {
  assetId: string;
  status: VideoAssetStatus;
  /** Playable URL (HLS manifest or a direct file URL for the mock). */
  playbackUrl?: string;
  posterUrl?: string;
  /** Seconds until playbackUrl must be refreshed. */
  expiresInSeconds?: number;
}

export interface VideoProbe {
  durationSeconds?: number;
  width?: number;
  height?: number;
  container?: string;
}

export interface PosterFrame {
  bytes: Uint8Array;
  contentType: 'image/png' | 'image/jpeg';
  /** True when this is a generated placeholder rather than a frame from the video. */
  placeholder: boolean;
}

/**
 * Video hosting/delivery (createAsset/getPlayback) plus the processing seam the media pipeline
 * uses for posters/keyframes and probing. `capabilities.poster` says whether real frames can be
 * extracted; adapters that cannot return an `unconfigured` failure and the pipeline falls back to
 * the placeholder. Metadata stripping of MP4/MOV is done in src/lib/media/mp4.ts without ffmpeg.
 */
export interface VideoProvider extends ProviderDescriptor {
  kind: 'video';
  createAsset(input: { objectKey: string }): Promise<Result<VideoAsset, ProviderFailure>>;
  getPlayback(assetId: string): Promise<Result<VideoPlayback, ProviderFailure>>;
  extractPoster(input: { bytes: Uint8Array; contentType: string; atSeconds?: number }): Promise<Result<PosterFrame, ProviderFailure>>;
  probe(input: { bytes: Uint8Array; contentType: string }): Promise<Result<VideoProbe, ProviderFailure>>;
}
