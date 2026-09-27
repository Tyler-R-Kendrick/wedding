import { env as serverEnv, type ServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
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

type VideoEnv = Partial<Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'FFMPEG_PATH' | 'CLOUDFLARE_ACCOUNT_ID' | 'CLOUDFLARE_STREAM_API_TOKEN' | 'CLOUDFLARE_STREAM_CUSTOMER_CODE' | 'isProduction'>>;

export const VIDEO_MOCK_IN_PRODUCTION_WARNING =
  'no ffmpeg binary (FFMPEG_PATH or PATH) on this host, e.g. Vercel: videos are not transcoded, probed or given posters';

const g = globalThis as unknown as { __weddingVideoMockWarned?: boolean };

/**
 * Selection: Cloudflare Stream (delivery) when its three variables exist, with ffmpeg or the mock
 * for local processing; otherwise ffmpeg alone when a binary exists (FFMPEG_PATH or PATH);
 * otherwise the mock. FORCE_MOCK_PROVIDERS pins the mock. The registry passes no env, so the
 * validated server environment is the default. The mock in production (no ffmpeg, e.g. Vercel) is
 * logged once and reported as a config warning, so it shows on the admin integrations page.
 */
export function createVideoProvider(deps: { storage: StorageProvider; env?: VideoEnv; warn?: (message: string) => void }): VideoProvider {
  const env: VideoEnv = deps.env ?? serverEnv;
  if (env.FORCE_MOCK_PROVIDERS) return new MockVideo(deps.storage);
  const binary = resolveFfmpegBinary(env.FFMPEG_PATH);
  // No ffmpeg (Vercel's runtime has none): the mock stands in. In production that must not be
  // silent — warn once per process, and carry the warning into describeProviders.
  const mockInProduction = !binary && !!env.isProduction;
  if (mockInProduction && !g.__weddingVideoMockWarned) {
    g.__weddingVideoMockWarned = true;
    (deps.warn ?? ((m: string) => logger.warn(m)))(`video: ${VIDEO_MOCK_IN_PRODUCTION_WARNING}; using the mock video provider`);
  }
  const processing: VideoProvider = binary
    ? new FfmpegVideo({ binary, storage: deps.storage })
    : new MockVideo(deps.storage, mockInProduction ? { warning: VIDEO_MOCK_IN_PRODUCTION_WARNING } : {});
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
