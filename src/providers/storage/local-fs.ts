import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isId, newId } from '@/contracts/ids';
import { err, ok } from '@/contracts/result';
import { hmacSha256, sha256Hex, timingSafeEqualString } from '@/lib/crypto';
import { failure, okConfig, upHealth } from '../base';
import {
  DEFAULT_DEV_READ_TTL_SECONDS,
  isAllowedUploadContentType,
  isValidKey,
  isValidPartNumber,
  MULTIPART_MANIFEST,
  type MultipartPart,
  type ObjectMeta,
  type SignedUrl,
  type StorageProvider,
  type StorageResult,
} from './types';

export interface LocalFsStorageOptions {
  dataDir: string;
  /** Origin used to build signed URLs, e.g. http://localhost:3000. */
  baseUrl: string;
  signingSecret: string;
  now?: () => Date;
}

export type DevStorageOp = 'get' | 'put' | 'part';

export interface DevStorageSignatureInput {
  op: DevStorageOp;
  key: string;
  exp: number;
  uploadId?: string;
  partNumber?: number;
  contentType?: string;
}

const NAME = 'local-fs';

function signatureBase(i: DevStorageSignatureInput): string {
  return [i.op, i.key, String(i.exp), i.uploadId ?? '', i.partNumber !== undefined ? String(i.partNumber) : '', i.contentType ?? ''].join('\n');
}

export function signDevStorage(secret: string, input: DevStorageSignatureInput): string {
  return hmacSha256(secret, signatureBase(input));
}

export function verifyDevStorage(secret: string, input: DevStorageSignatureInput, signature: string, now: Date = new Date()): boolean {
  if (!Number.isFinite(input.exp) || input.exp * 1000 < now.getTime()) return false;
  return timingSafeEqualString(signDevStorage(secret, input), signature);
}

/**
 * Local filesystem storage for development. Objects live under `<dataDir>/objects/<key>`;
 * their metadata under `<dataDir>/meta/<sha256(key)>.json` (never next to the object, so no
 * key can name or shadow a sidecar); multipart parts under `<dataDir>/multipart/<uploadId>/`
 * where `uploadId` is always one of our ULIDs. Signed URLs point at /api/dev/storage/<key>
 * and carry an HMAC + expiry.
 */
export class LocalFsStorage implements StorageProvider {
  readonly kind = 'storage' as const;
  readonly name = NAME;
  readonly mode = 'mock' as const;
  readonly capabilities = {
    putObject: true, getObject: true, deleteObject: true, head: true,
    signedUpload: true, signedRead: true, multipart: true,
  };
  private readonly now: () => Date;

  constructor(private readonly opts: LocalFsStorageOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  validateConfig() {
    return okConfig(['local-fs storage is for development only']);
  }
  async health() {
    try {
      await fs.mkdir(this.objectsDir, { recursive: true });
      return upHealth(this.opts.dataDir);
    } catch (e) {
      return { status: 'down' as const, checkedAt: this.now().toISOString(), detail: e instanceof Error ? e.message : 'fs error' };
    }
  }

  get dataDir() {
    return this.opts.dataDir;
  }

  /** Verifies a signed dev URL against THIS instance's secret (the dev route never resolves the secret itself). */
  verifySignedRequest(input: DevStorageSignatureInput, signature: string, now: Date = this.now()): boolean {
    return verifyDevStorage(this.opts.signingSecret, input, signature, now);
  }

  private get objectsDir() {
    return path.join(this.opts.dataDir, 'objects');
  }
  private get metaDir() {
    return path.join(this.opts.dataDir, 'meta');
  }
  private get multipartDir() {
    return path.join(this.opts.dataDir, 'multipart');
  }
  private objectPath(key: string) {
    return path.join(this.objectsDir, key);
  }
  private metaPath(key: string) {
    return path.join(this.metaDir, `${sha256Hex(key)}.json`);
  }
  /** Only ever called with an `isId`-validated upload id, so the path cannot leave `multipartDir`. */
  private uploadDir(uploadId: string) {
    return path.join(this.multipartDir, uploadId);
  }

  private invalidKey(key: string) {
    return failure(NAME, 'bad_request', 'Invalid storage key.', { raw: { key } });
  }
  private invalidUploadId() {
    return failure(NAME, 'bad_request', 'Invalid upload id.');
  }
  private invalidPartNumber() {
    return failure(NAME, 'bad_request', 'Invalid part number.');
  }
  private unsupportedType() {
    return failure(NAME, 'bad_request', 'That file type is not supported.');
  }

  async putObject(key: string, body: Uint8Array, opts: { contentType: string }) {
    if (!isValidKey(key)) return err(this.invalidKey(key));
    const p = this.objectPath(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.mkdir(this.metaDir, { recursive: true });
    await fs.writeFile(p, body);
    const meta: ObjectMeta = {
      key,
      size: body.byteLength,
      contentType: opts.contentType,
      etag: createHash('md5').update(body).digest('hex'),
      lastModified: this.now().toISOString(),
    };
    await fs.writeFile(this.metaPath(key), JSON.stringify(meta));
    return ok(meta);
  }

  async head(key: string) {
    if (!isValidKey(key)) return err(this.invalidKey(key));
    try {
      const raw = await fs.readFile(this.metaPath(key), 'utf8');
      const meta = JSON.parse(raw) as ObjectMeta;
      return ok(meta.key === key ? meta : null);
    } catch {
      return ok(null);
    }
  }

  async getObject(key: string) {
    if (!isValidKey(key)) return err(this.invalidKey(key));
    const meta = await this.head(key);
    if (!meta.ok || !meta.value) return ok(null);
    try {
      const body = await fs.readFile(this.objectPath(key));
      return ok({ ...meta.value, body: new Uint8Array(body) });
    } catch {
      return ok(null);
    }
  }

  async deleteObject(key: string) {
    if (!isValidKey(key)) return err(this.invalidKey(key));
    await fs.rm(this.objectPath(key), { force: true });
    await fs.rm(this.metaPath(key), { force: true });
    return ok(undefined);
  }

  private signed(input: Omit<DevStorageSignatureInput, 'exp'>, expiresInSeconds: number, method: 'PUT' | 'GET'): SignedUrl {
    const exp = Math.floor(this.now().getTime() / 1000) + expiresInSeconds;
    const full: DevStorageSignatureInput = { ...input, exp };
    const params = new URLSearchParams({ op: input.op, exp: String(exp), sig: signDevStorage(this.opts.signingSecret, full) });
    if (input.uploadId) params.set('uploadId', input.uploadId);
    if (input.partNumber !== undefined) params.set('partNumber', String(input.partNumber));
    if (input.contentType) params.set('ct', input.contentType);
    return {
      url: `${this.opts.baseUrl}/api/dev/storage/${input.key}?${params.toString()}`,
      method,
      headers: input.contentType ? { 'Content-Type': input.contentType } : {},
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  async createSignedUploadUrl(input: { key: string; contentType: string; expiresInSeconds?: number }) {
    if (!isValidKey(input.key)) return err(this.invalidKey(input.key));
    if (!isAllowedUploadContentType(input.contentType)) return err(this.unsupportedType());
    return ok(this.signed({ op: 'put', key: input.key, contentType: input.contentType }, input.expiresInSeconds ?? 900, 'PUT'));
  }

  async createSignedReadUrl(input: { key: string; expiresInSeconds?: number }) {
    if (!isValidKey(input.key)) return err(this.invalidKey(input.key));
    return ok(this.signed({ op: 'get', key: input.key }, input.expiresInSeconds ?? DEFAULT_DEV_READ_TTL_SECONDS, 'GET'));
  }

  async initiateMultipartUpload(input: { key: string; contentType: string }) {
    if (!isValidKey(input.key)) return err(this.invalidKey(input.key));
    if (!isAllowedUploadContentType(input.contentType)) return err(this.unsupportedType());
    const uploadId = newId();
    const dir = this.uploadDir(uploadId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, MULTIPART_MANIFEST), JSON.stringify({ key: input.key, contentType: input.contentType, startedAt: this.now().toISOString() }));
    return ok({ uploadId });
  }

  async signMultipartPart(input: { key: string; uploadId: string; partNumber: number; expiresInSeconds?: number }) {
    if (!isValidKey(input.key)) return err(this.invalidKey(input.key));
    if (!isId(input.uploadId)) return err(this.invalidUploadId());
    if (!isValidPartNumber(input.partNumber)) return err(this.invalidPartNumber());
    return ok(this.signed({ op: 'part', key: input.key, uploadId: input.uploadId, partNumber: input.partNumber }, input.expiresInSeconds ?? 900, 'PUT'));
  }

  /** Called by the dev route to persist an uploaded part. Returns the part's etag. */
  async writeMultipartPart(uploadId: string, partNumber: number, body: Uint8Array): StorageResult<string> {
    if (!isId(uploadId)) return err(this.invalidUploadId());
    if (!isValidPartNumber(partNumber)) return err(this.invalidPartNumber());
    const dir = this.uploadDir(uploadId);
    try {
      await fs.access(path.join(dir, MULTIPART_MANIFEST));
    } catch {
      return err(failure(NAME, 'not_found', 'Upload not found.'));
    }
    await fs.writeFile(path.join(dir, `part-${partNumber}`), body);
    return ok(createHash('md5').update(body).digest('hex'));
  }

  async completeMultipartUpload(input: { key: string; uploadId: string; parts: MultipartPart[] }) {
    if (!isValidKey(input.key)) return err(this.invalidKey(input.key));
    if (!isId(input.uploadId)) return err(this.invalidUploadId());
    if (!input.parts.every((p) => isValidPartNumber(p.partNumber))) return err(this.invalidPartNumber());
    const dir = this.uploadDir(input.uploadId);
    let info: { key: string; contentType: string };
    try {
      info = JSON.parse(await fs.readFile(path.join(dir, MULTIPART_MANIFEST), 'utf8')) as { key: string; contentType: string };
    } catch {
      return err(failure(NAME, 'not_found', 'Upload not found.'));
    }
    if (info.key !== input.key) return err(failure(NAME, 'bad_request', 'Upload does not match key.'));
    const chunks: Uint8Array[] = [];
    for (const part of [...input.parts].sort((a, b) => a.partNumber - b.partNumber)) {
      try {
        chunks.push(new Uint8Array(await fs.readFile(path.join(dir, `part-${part.partNumber}`))));
      } catch {
        return err(failure(NAME, 'bad_request', `Missing part ${part.partNumber}.`));
      }
    }
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const body = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      body.set(c, offset);
      offset += c.byteLength;
    }
    const result = await this.putObject(input.key, body, { contentType: info.contentType });
    await fs.rm(dir, { recursive: true, force: true });
    return result;
  }

  async abortMultipartUpload(input: { key: string; uploadId: string }) {
    if (!isValidKey(input.key)) return err(this.invalidKey(input.key));
    if (!isId(input.uploadId)) return err(this.invalidUploadId());
    await fs.rm(this.uploadDir(input.uploadId), { recursive: true, force: true });
    return ok(undefined);
  }
}
