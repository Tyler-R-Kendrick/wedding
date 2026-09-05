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

export function isValidKey(key: string): boolean {
  if (!KEY_PATTERN.test(key)) return false;
  if (key.includes('..') || key.includes('//') || key.endsWith('/')) return false;
  return true;
}

export const MAX_PART_NUMBER = 10_000;
