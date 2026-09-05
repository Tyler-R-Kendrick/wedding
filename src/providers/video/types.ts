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

/**
 * Video hosting/transcoding. Keyframe extraction and ffmpeg live in the media swarm;
 * an ffmpeg-based adapter should read FFMPEG_PATH (default: `ffmpeg` on PATH).
 */
export interface VideoProvider extends ProviderDescriptor {
  kind: 'video';
  createAsset(input: { objectKey: string }): Promise<Result<VideoAsset, ProviderFailure>>;
  getPlayback(assetId: string): Promise<Result<VideoPlayback, ProviderFailure>>;
}
