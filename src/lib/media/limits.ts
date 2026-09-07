/**
 * Upload limits and the content-type allowlist. Types are decided by sniffing the bytes
 * (src/lib/media/sniff.ts); the declared type is only a hint for the pre-upload size cap.
 */
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
export const VIDEO_MIMES = ['video/mp4', 'video/quicktime'] as const;
export const ALLOWED_MIMES = [...IMAGE_MIMES, ...VIDEO_MIMES] as const;
export type AllowedMime = (typeof ALLOWED_MIMES)[number];
export type MediaKindOf = 'image' | 'video';

export const EXTENSION_FOR_MIME: Record<AllowedMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

const MIME_FOR_EXTENSION: Record<string, AllowedMime> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
};

export function isAllowedMime(mime: string): mime is AllowedMime {
  return (ALLOWED_MIMES as readonly string[]).includes(mime);
}

export function kindForMime(mime: string): MediaKindOf | null {
  if ((IMAGE_MIMES as readonly string[]).includes(mime)) return 'image';
  if ((VIDEO_MIMES as readonly string[]).includes(mime)) return 'video';
  return null;
}

/** Browsers send '' for HEIC/MOV on some platforms: fall back to the extension as a *hint* only. */
export function hintMime(declared: string | undefined, filename: string): AllowedMime | null {
  const d = (declared ?? '').trim().toLowerCase();
  if (isAllowedMime(d)) return d;
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return MIME_FOR_EXTENSION[ext] ?? null;
}

export const MiB = 1024 * 1024;
/** S3/R2 reject multipart parts smaller than 5 MiB (except the last). */
export const S3_MIN_PART_BYTES = 5 * MiB;
export const MAX_FILES_PER_BATCH = 20;
export const MAX_CAPTION_CHARS = 280;
export const MAX_FILENAME_CHARS = 120;
/** Decompression-bomb guards for the image decoder. */
export const MAX_IMAGE_PIXELS = 80_000_000;
export const MAX_IMAGE_DIMENSION = 16_000;
/** Signed upload URLs live this long; the upload row expires with them. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
/** Signed read URLs for derivatives. */
export const READ_URL_TTL_SECONDS = 60 * 60;

export interface MediaLimits {
  maxImageBytes: number;
  maxVideoBytes: number;
  partSizeBytes: number;
  multipartThresholdBytes: number;
}

export const DEFAULT_LIMITS: MediaLimits = {
  maxImageBytes: 40 * MiB,
  maxVideoBytes: 512 * MiB,
  partSizeBytes: 8 * MiB,
  multipartThresholdBytes: 8 * MiB,
};

export function limitsFromEnv(env: { MEDIA_MAX_IMAGE_MB: number; MEDIA_MAX_VIDEO_MB: number; MEDIA_PART_SIZE_MB: number; MEDIA_MULTIPART_THRESHOLD_MB: number }): MediaLimits {
  return {
    maxImageBytes: env.MEDIA_MAX_IMAGE_MB * MiB,
    maxVideoBytes: env.MEDIA_MAX_VIDEO_MB * MiB,
    partSizeBytes: env.MEDIA_PART_SIZE_MB * MiB,
    multipartThresholdBytes: env.MEDIA_MULTIPART_THRESHOLD_MB * MiB,
  };
}

export function maxBytesFor(kind: MediaKindOf, limits: MediaLimits = DEFAULT_LIMITS): number {
  return kind === 'image' ? limits.maxImageBytes : limits.maxVideoBytes;
}

export type SizeCheck = { ok: true } | { ok: false; reason: 'empty' | 'too_large'; maxBytes: number };

export function checkSize(kind: MediaKindOf, bytes: number, limits: MediaLimits = DEFAULT_LIMITS): SizeCheck {
  const maxBytes = maxBytesFor(kind, limits);
  if (!Number.isFinite(bytes) || bytes <= 0) return { ok: false, reason: 'empty', maxBytes };
  if (bytes > maxBytes) return { ok: false, reason: 'too_large', maxBytes };
  return { ok: true };
}

export interface UploadPlan {
  multipart: boolean;
  partSize: number;
  partCount: number;
}

/** Single PUT below the threshold; otherwise fixed-size parts (the last one may be smaller). */
export function planUpload(bytes: number, limits: MediaLimits = DEFAULT_LIMITS): UploadPlan {
  if (bytes <= limits.multipartThresholdBytes) return { multipart: false, partSize: bytes, partCount: 1 };
  const partSize = limits.partSizeBytes;
  return { multipart: true, partSize, partCount: Math.ceil(bytes / partSize) };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * MiB) return `${(bytes / (1024 * MiB)).toFixed(1)} GB`;
  if (bytes >= MiB) return `${(bytes / MiB).toFixed(bytes >= 10 * MiB ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
