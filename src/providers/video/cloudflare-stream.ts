import { err, ok } from '@/contracts/result';
import { DEFAULT_CALL_POLICY } from '@/contracts/providers';
import { failure, missingConfig, okConfig, upHealth } from '../base';
import type { StorageProvider } from '../storage/types';
import type { VideoAsset, VideoAssetStatus, VideoProvider } from './types';

/**
 * Cloudflare Stream delivery adapter (skeleton). Ingest copies from a short-lived signed read URL of
 * our private object (server to server; no bucket URL is ever exposed), playback is signed HLS.
 * Poster/probe processing is delegated to the local processing provider (ffmpeg or mock).
 * Selected when CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_STREAM_API_TOKEN + CLOUDFLARE_STREAM_CUSTOMER_CODE exist.
 */
export interface CloudflareStreamOptions {
  accountId: string;
  apiToken: string;
  customerCode: string;
  storage: StorageProvider;
  /** Local processing seam (ffmpeg or mock). */
  processing: Pick<VideoProvider, 'extractPoster' | 'probe' | 'capabilities'>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Playback token lifetime. */
  tokenTtlSeconds?: number;
}

interface StreamVideo {
  uid: string;
  readyToStream?: boolean;
  status?: { state?: string };
  thumbnail?: string;
  meta?: Record<string, unknown>;
}

const NAME = 'cloudflare-stream';

export class CloudflareStreamVideo implements VideoProvider {
  readonly kind = 'video' as const;
  readonly name = NAME;
  readonly mode = 'live' as const;
  readonly capabilities: Record<string, boolean>;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: CloudflareStreamOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.capabilities = { createAsset: true, getPlayback: true, hls: true, poster: opts.processing.capabilities.poster === true, probe: opts.processing.capabilities.probe === true };
  }

  validateConfig() {
    const missing: string[] = [];
    if (!this.opts.accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
    if (!this.opts.apiToken) missing.push('CLOUDFLARE_STREAM_API_TOKEN');
    if (!this.opts.customerCode) missing.push('CLOUDFLARE_STREAM_CUSTOMER_CODE');
    return missing.length ? missingConfig(missing) : okConfig();
  }

  async health() {
    const started = performance.now();
    const res = await this.api('GET', '/stream?limit=1');
    if (!res.ok) return { status: 'down' as const, checkedAt: new Date().toISOString(), detail: res.error.class };
    return { ...upHealth(), latencyMs: Math.round(performance.now() - started) };
  }

  private get base() {
    return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.opts.accountId)}`;
  }

  private async api<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown) {
    try {
      const res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.opts.apiToken}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? DEFAULT_CALL_POLICY.timeoutMs),
      });
      if (res.status === 429) return err(failure(NAME, 'rate_limited', 'Video service is busy. Please try again shortly.', { retryAfterMs: Number(res.headers.get('retry-after') ?? 5) * 1000 }));
      if (res.status === 401 || res.status === 403) return err(failure(NAME, 'auth', 'Video service is not available right now.'));
      if (res.status === 404) return err(failure(NAME, 'not_found', 'Video not found.'));
      if (res.status >= 500) return err(failure(NAME, 'server', 'Video service is not available right now.'));
      if (!res.ok) return err(failure(NAME, 'bad_request', 'Video service rejected the request.'));
      const json = (await res.json()) as { success?: boolean; result?: T };
      if (!json.success || json.result === undefined) return err(failure(NAME, 'malformed_response', 'Video service returned an unexpected answer.'));
      return ok(json.result);
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') return err(failure(NAME, 'timeout', 'Video service timed out.', { raw: e }));
      return err(failure(NAME, 'network', 'Video service could not be reached.', { raw: e }));
    }
  }

  async createAsset(input: { objectKey: string }) {
    const signed = await this.opts.storage.createSignedReadUrl({ key: input.objectKey, expiresInSeconds: 3600 });
    if (!signed.ok) return err(signed.error);
    const res = await this.api<StreamVideo>('POST', '/stream/copy', { url: signed.value.url, meta: { name: input.objectKey }, requireSignedURLs: true });
    if (!res.ok) return res;
    const asset: VideoAsset = { assetId: res.value.uid, status: toStatus(res.value), sourceKey: input.objectKey };
    return ok(asset);
  }

  async getPlayback(assetId: string) {
    if (!/^[A-Za-z0-9]{8,64}$/.test(assetId)) return err(failure(NAME, 'bad_request', 'Invalid video id.'));
    const video = await this.api<StreamVideo>('GET', `/stream/${assetId}`);
    if (!video.ok) return video;
    const status = toStatus(video.value);
    if (status !== 'ready') return ok({ assetId, status });
    const ttl = this.opts.tokenTtlSeconds ?? 3600;
    const token = await this.api<{ token: string }>('POST', `/stream/${assetId}/token`, { exp: Math.floor(Date.now() / 1000) + ttl });
    if (!token.ok) return token;
    const host = `https://customer-${this.opts.customerCode}.cloudflarestream.com`;
    return ok({
      assetId,
      status,
      playbackUrl: `${host}/${token.value.token}/manifest/video.m3u8`,
      posterUrl: `${host}/${token.value.token}/thumbnails/thumbnail.jpg`,
      expiresInSeconds: ttl,
    });
  }

  extractPoster(input: { bytes: Uint8Array; contentType: string; atSeconds?: number }) {
    return this.opts.processing.extractPoster(input);
  }

  probe(input: { bytes: Uint8Array; contentType: string }) {
    return this.opts.processing.probe(input);
  }
}

function toStatus(v: StreamVideo): VideoAssetStatus {
  if (v.readyToStream) return 'ready';
  if (v.status?.state === 'error') return 'errored';
  return 'preparing';
}
