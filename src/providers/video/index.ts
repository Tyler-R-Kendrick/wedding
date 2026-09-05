import type { StorageProvider } from '../storage/types';
import { MockVideo } from './mock';
import type { VideoProvider } from './types';

export * from './types';
export { MockVideo } from './mock';

/** Only the mock exists at level 03; the media swarm adds a hosted adapter (FFMPEG_PATH for local keyframes). */
export function createVideoProvider(deps: { storage: StorageProvider }): VideoProvider {
  return new MockVideo(deps.storage);
}
