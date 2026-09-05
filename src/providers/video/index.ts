import type { ServerEnv } from '@/lib/env';
import type { StorageProvider } from '../storage/types';
import { CloudflareStreamVideo } from './cloudflare-stream';
import { FfmpegVideo, resolveFfmpegBinary } from './ffmpeg';
import { MockVideo } from './mock';
import type { VideoProvider } from './types';

export * from './types';
export { MockVideo } from './mock';
export { FfmpegVideo, resolveFfmpegBinary, parseProbe, type FfmpegCapabilities } from './ffmpeg';
export { CloudflareStreamVideo, type CloudflareStreamOptions } from './cloudflare-stream';
export { placeholderPosterPng, PLACEHOLDER_POSTER_WIDTH, PLACEHOLDER_POSTER_HEIGHT } from './placeholder';

type VideoEnv = Partial<Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'FFMPEG_PATH' | 'CLOUDFLARE_ACCOUNT_ID' | 'CLOUDFLARE_STREAM_API_TOKEN' | 'CLOUDFLARE_STREAM_CUSTOMER_CODE'>>;

/**
 * Selection: Cloudflare Stream (delivery) when its three variables exist, with ffmpeg or the mock
 * for local processing; otherwise ffmpeg alone when a binary exists (FFMPEG_PATH or PATH);
 * otherwise the mock. FORCE_MOCK_PROVIDERS pins the mock.
 */
export function createVideoProvider(deps: { storage: StorageProvider; env?: VideoEnv }): VideoProvider {
  const env = deps.env ?? {};
  if (env.FORCE_MOCK_PROVIDERS) return new MockVideo(deps.storage);
  const binary = resolveFfmpegBinary(env.FFMPEG_PATH);
  const processing: VideoProvider = binary ? new FfmpegVideo({ binary, storage: deps.storage }) : new MockVideo(deps.storage);
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_STREAM_API_TOKEN && env.CLOUDFLARE_STREAM_CUSTOMER_CODE) {
    return new CloudflareStreamVideo({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: env.CLOUDFLARE_STREAM_API_TOKEN,
      customerCode: env.CLOUDFLARE_STREAM_CUSTOMER_CODE,
      storage: deps.storage,
      processing,
    });
  }
  return processing;
}
