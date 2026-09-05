import { execFile } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { err, ok } from '@/contracts/result';
import { failure, fnv1a, okConfig, unconfiguredHealth, upHealth } from '../base';
import type { StorageProvider } from '../storage/types';
import { placeholderPosterPng } from './placeholder';
import type { PosterFrame, VideoAsset, VideoProbe, VideoProvider } from './types';

const execFileAsync = promisify(execFile);
const NAME = 'ffmpeg';
const RUN_TIMEOUT_MS = 60_000;

/** What the binary on this machine can actually do (Playwright's bundled ffmpeg, for example, has no MP4 support). */
export interface FfmpegCapabilities {
  version: string;
  demuxers: Set<string>;
  muxers: Set<string>;
  encoders: Set<string>;
}

/** Resolve FFMPEG_PATH or `ffmpeg` on PATH to an existing file, else null. */
export function resolveFfmpegBinary(configured: string | undefined, pathEnv: string | undefined = process.env.PATH): string | null {
  if (configured) return existsSync(configured) ? configured : null;
  for (const dir of (pathEnv ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, 'ffmpeg');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function containerDemuxer(contentType: string): string {
  switch (contentType) {
    case 'video/mp4':
    case 'video/quicktime':
      return 'mov,mp4,m4a,3gp,3g2,mj2';
    case 'video/webm':
      return 'matroska,webm';
    default:
      return contentType;
  }
}

function parseList(stdout: string): Set<string> {
  const names = new Set<string>();
  for (const line of stdout.split('\n')) {
    const m = /^\s*[A-Z.]{1,6}\s+(\S+)/.exec(line);
    if (m && m[1] && !/^-+$/.test(m[1])) names.add(m[1]);
  }
  return names;
}

/**
 * ffmpeg-backed processing (posters/keyframes, probing) with the same local delivery as the mock
 * (signed read URL of the stripped object). Capabilities are detected from the binary once, so a
 * build without MP4 support reports `poster: false` for MP4 and the pipeline uses the placeholder.
 */
export class FfmpegVideo implements VideoProvider {
  readonly kind = 'video' as const;
  readonly name = NAME;
  readonly mode = 'live' as const;
  readonly capabilities: Record<string, boolean> = { createAsset: true, getPlayback: true, hls: false, poster: true, probe: true };
  private caps?: Promise<FfmpegCapabilities | null>;
  private readonly assets = new Map<string, VideoAsset>();

  constructor(private readonly opts: { binary: string; storage: StorageProvider; timeoutMs?: number }) {}

  validateConfig() {
    return existsSync(this.opts.binary) ? okConfig() : { ok: false, missing: ['FFMPEG_PATH'], warnings: [] };
  }

  async health() {
    const caps = await this.detect();
    if (!caps) return unconfiguredHealth('ffmpeg did not answer');
    return upHealth(`ffmpeg ${caps.version}; mp4 demux=${caps.demuxers.has('mov,mp4,m4a,3gp,3g2,mj2')}`);
  }

  /** Detects demuxers/muxers/encoders once per process. */
  detect(): Promise<FfmpegCapabilities | null> {
    this.caps ??= (async () => {
      try {
        const run = (args: string[]) => execFileAsync(this.opts.binary, ['-hide_banner', ...args], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
        const [version, demuxers, muxers, encoders] = await Promise.all([run(['-version']), run(['-demuxers']), run(['-muxers']), run(['-encoders'])]);
        const v = /ffmpeg version (\S+)/.exec(version.stdout)?.[1] ?? 'unknown';
        return { version: v, demuxers: parseList(demuxers.stdout), muxers: parseList(muxers.stdout), encoders: parseList(encoders.stdout) };
      } catch {
        return null;
      }
    })();
    return this.caps;
  }

  async canExtractPoster(contentType: string): Promise<boolean> {
    const caps = await this.detect();
    if (!caps) return false;
    return caps.demuxers.has(containerDemuxer(contentType)) && (caps.encoders.has('png') || caps.encoders.has('mjpeg'));
  }

  async createAsset(input: { objectKey: string }) {
    const assetId = `ffmpeg_${fnv1a(input.objectKey).toString(16).padStart(8, '0')}`;
    const asset: VideoAsset = { assetId, status: 'ready', sourceKey: input.objectKey };
    this.assets.set(assetId, asset);
    return ok(asset);
  }

  async getPlayback(assetId: string) {
    const asset = this.assets.get(assetId);
    if (!asset) return err(failure(NAME, 'not_found', 'Video not found.'));
    const signed = await this.opts.storage.createSignedReadUrl({ key: asset.sourceKey, expiresInSeconds: 3600 });
    if (!signed.ok) return err(signed.error);
    return ok({ assetId, status: asset.status, playbackUrl: signed.value.url, expiresInSeconds: 3600 });
  }

  private async withTempFile<T>(bytes: Uint8Array, fn: (file: string) => Promise<T>): Promise<T> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wedding-ffmpeg-'));
    const file = path.join(dir, 'input');
    try {
      await fs.writeFile(file, bytes);
      return await fn(file);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  async extractPoster(input: { bytes: Uint8Array; contentType: string; atSeconds?: number }) {
    if (!(await this.canExtractPoster(input.contentType))) {
      const caps = await this.detect();
      if (!caps) return err(failure(NAME, 'unconfigured', 'Video frames cannot be extracted right now.'));
      // Honest fallback: this build cannot read that container.
      const frame: PosterFrame = { bytes: placeholderPosterPng(), contentType: 'image/png', placeholder: true };
      return ok(frame);
    }
    const caps = (await this.detect())!;
    const encoder = caps.encoders.has('png') ? 'png' : 'mjpeg';
    try {
      const out = await this.withTempFile(input.bytes, async (file) => {
        const args = ['-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, input.atSeconds ?? 0.5)), '-i', file, '-frames:v', '1', '-vf', "scale='min(1600,iw)':-2", '-f', 'image2', '-c:v', encoder, 'pipe:1'];
        const { stdout } = await execFileAsync(this.opts.binary, args, { encoding: 'buffer', timeout: this.opts.timeoutMs ?? RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
        return new Uint8Array(stdout);
      });
      if (out.byteLength === 0) return err(failure(NAME, 'malformed_response', 'No frame could be read from that video.'));
      const frame: PosterFrame = { bytes: out, contentType: encoder === 'png' ? 'image/png' : 'image/jpeg', placeholder: false };
      return ok(frame);
    } catch (e) {
      return err(this.classify(e));
    }
  }

  async probe(input: { bytes: Uint8Array; contentType: string }) {
    const caps = await this.detect();
    if (!caps) return err(failure(NAME, 'unconfigured', 'Video probing is not available.'));
    if (!caps.demuxers.has(containerDemuxer(input.contentType))) return ok<VideoProbe>({});
    try {
      const stderr = await this.withTempFile(input.bytes, async (file) => {
        try {
          const res = await execFileAsync(this.opts.binary, ['-hide_banner', '-i', file, '-f', 'null', '-'], { timeout: this.opts.timeoutMs ?? RUN_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
          return res.stderr;
        } catch (e) {
          return (e as { stderr?: string }).stderr ?? '';
        }
      });
      return ok(parseProbe(stderr));
    } catch (e) {
      return err(this.classify(e));
    }
  }

  private classify(e: unknown) {
    const killed = (e as { killed?: boolean }).killed;
    if (killed) return failure(NAME, 'timeout', 'Video processing timed out.', { raw: e });
    return failure(NAME, 'server', 'Video processing failed.', { raw: e });
  }
}

/** Parses ffmpeg's stderr banner: "Duration: 00:00:02.00" and "Video: ... 320x240". */
export function parseProbe(stderr: string): VideoProbe {
  const out: VideoProbe = {};
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (d) out.durationSeconds = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  const v = /Video:.*?\s(\d{2,5})x(\d{2,5})/.exec(stderr);
  if (v) {
    out.width = Number(v[1]);
    out.height = Number(v[2]);
  }
  const c = /Input #0,\s*([^,]+),/.exec(stderr);
  if (c) out.container = c[1]!.trim();
  return out;
}
