import type { ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';

export interface ObjectMeta {
  key: string;
  size: number;
  contentType: string;
  etag: string;
  lastModified: string;
}

export interface StoredObject extends ObjectMeta {
  body: Uint8Array;
}

export interface SignedUrl {
  url: string;
  method: 'PUT' | 'GET';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface MultipartPart {
  partNumber: number;
  etag: string;
}

export type StorageResult<T> = Promise<Result<T, ProviderFailure>>;

/**
 * Object storage. Keys are POSIX-like paths (`media/<id>/original.jpg`), validated by `isValidKey`.
 * Signed URLs let browsers upload/download without the server proxying bytes.
 */
export interface StorageProvider extends ProviderDescriptor {
  kind: 'storage';
  putObject(key: string, body: Uint8Array, opts: { contentType: string }): StorageResult<ObjectMeta>;
  getObject(key: string): StorageResult<StoredObject | null>;
  deleteObject(key: string): StorageResult<void>;
  head(key: string): StorageResult<ObjectMeta | null>;
  createSignedUploadUrl(input: { key: string; contentType: string; expiresInSeconds?: number; maxBytes?: number }): StorageResult<SignedUrl>;
  createSignedReadUrl(input: { key: string; expiresInSeconds?: number }): StorageResult<SignedUrl>;
  initiateMultipartUpload(input: { key: string; contentType: string }): StorageResult<{ uploadId: string }>;
  signMultipartPart(input: { key: string; uploadId: string; partNumber: number; expiresInSeconds?: number }): StorageResult<SignedUrl>;
  completeMultipartUpload(input: { key: string; uploadId: string; parts: MultipartPart[] }): StorageResult<ObjectMeta>;
  abortMultipartUpload(input: { key: string; uploadId: string }): StorageResult<void>;
}

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,511}$/;
/** Legacy sidecar suffix; keys may never end with it even though sidecars now live under <dataDir>/meta. */
export const META_SIDECAR_SUFFIX = '.meta.json';
/** Multipart bookkeeping file name; never a valid object key segment. */
export const MULTIPART_MANIFEST = 'upload.json';

/**
 * POSIX-like object keys: no traversal, no empty/dot segments, no reserved bookkeeping names.
 * Both adapters call this on every key they receive.
 */
export function isValidKey(key: string): boolean {
  if (!KEY_PATTERN.test(key)) return false;
  if (key.includes('..') || key.includes('//') || key.endsWith('/')) return false;
  if (key.endsWith(META_SIDECAR_SUFFIX)) return false;
  const segments = key.split('/');
  if (segments.some((s) => s.startsWith('.'))) return false;
  if (segments[segments.length - 1] === MULTIPART_MANIFEST) return false;
  return true;
}

export const MAX_PART_NUMBER = 10_000;
export const isValidPartNumber = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_PART_NUMBER;

/** Signed dev read URLs are short-lived; S3 presigned reads keep their own default. */
export const DEFAULT_DEV_READ_TTL_SECONDS = 5 * 60;

/** Only guest media types may be uploaded through signed URLs (both adapters enforce this at sign time). */
export const ALLOWED_UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime'] as const;
export type AllowedUploadContentType = (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number];
export function isAllowedUploadContentType(contentType: string): contentType is AllowedUploadContentType {
  return (ALLOWED_UPLOAD_CONTENT_TYPES as readonly string[]).includes(contentType.trim().toLowerCase());
}
