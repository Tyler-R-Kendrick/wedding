import { err, ok } from '@/contracts/result';
import { failure, okConfig, upHealth } from '../base';
import { isValidKey, type MultipartPart, type ObjectMeta, type StorageProvider } from './types';

export interface S3StorageOptions {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

type S3Module = typeof import('@aws-sdk/client-s3');
type PresignModule = typeof import('@aws-sdk/s3-request-presigner');

/**
 * S3-compatible adapter (AWS S3, Cloudflare R2, MinIO). Selected when the S3_* variables exist.
 * SDK modules load lazily so the mock path never pays for them.
 */
export class S3Storage implements StorageProvider {
  readonly kind = 'storage' as const;
  readonly name = 's3';
  readonly mode = 'live' as const;
  readonly capabilities = {
    putObject: true, getObject: true, deleteObject: true, head: true,
    signedUpload: true, signedRead: true, multipart: true,
  };
  private clientPromise?: Promise<{ s3: S3Module; presign: PresignModule; client: InstanceType<S3Module['S3Client']> }>;

  constructor(private readonly opts: S3StorageOptions) {}

  validateConfig() {
    return okConfig();
  }

  async health() {
    try {
      const { s3, client } = await this.sdk();
      const started = performance.now();
      await client.send(new s3.HeadBucketCommand({ Bucket: this.opts.bucket }));
      return { ...upHealth(), latencyMs: Math.round(performance.now() - started) };
    } catch (e) {
      return { status: 'down' as const, checkedAt: new Date().toISOString(), detail: e instanceof Error ? e.name : 'error' };
    }
  }

  private sdk() {
    this.clientPromise ??= (async () => {
      const [s3, presign] = await Promise.all([import('@aws-sdk/client-s3'), import('@aws-sdk/s3-request-presigner')]);
      const client = new s3.S3Client({
        region: this.opts.region,
        ...(this.opts.endpoint ? { endpoint: this.opts.endpoint } : {}),
        forcePathStyle: this.opts.forcePathStyle ?? true,
        credentials: { accessKeyId: this.opts.accessKeyId, secretAccessKey: this.opts.secretAccessKey },
      });
      return { s3, presign, client };
    })();
    return this.clientPromise;
  }

  private classify(e: unknown) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'NotFound' || name === 'NoSuchKey') return failure(this.name, 'not_found', 'File not found.', { raw: e });
    if (name === 'AccessDenied' || name === 'InvalidAccessKeyId' || name === 'SignatureDoesNotMatch') return failure(this.name, 'auth', 'Storage is not available right now.', { raw: e });
    if (name === 'TimeoutError') return failure(this.name, 'timeout', 'Storage timed out. Please try again.', { raw: e });
    return failure(this.name, 'server', 'Storage is not available right now.', { raw: e });
  }

  async putObject(key: string, body: Uint8Array, opts: { contentType: string }) {
    if (!isValidKey(key)) return err(failure(this.name, 'bad_request', 'Invalid storage key.'));
    try {
      const { s3, client } = await this.sdk();
      const res = await client.send(new s3.PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: body, ContentType: opts.contentType }));
      return ok<ObjectMeta>({ key, size: body.byteLength, contentType: opts.contentType, etag: (res.ETag ?? '').replaceAll('"', ''), lastModified: new Date().toISOString() });
    } catch (e) {
      return err(this.classify(e));
    }
  }

  async getObject(key: string) {
    if (!isValidKey(key)) return err(failure(this.name, 'bad_request', 'Invalid storage key.'));
    try {
      const { s3, client } = await this.sdk();
      const res = await client.send(new s3.GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) return ok(null);
      return ok({
        key,
        body: bytes,
        size: res.ContentLength ?? bytes.byteLength,
        contentType: res.ContentType ?? 'application/octet-stream',
        etag: (res.ETag ?? '').replaceAll('"', ''),
        lastModified: (res.LastModified ?? new Date()).toISOString(),
      });
    } catch (e) {
      const f = this.classify(e);
      return f.class === 'not_found' ? ok(null) : err(f);
    }
  }

  async deleteObject(key: string) {
    try {
      const { s3, client } = await this.sdk();
      await client.send(new s3.DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      return ok(undefined);
    } catch (e) {
      return err(this.classify(e));
    }
  }

  async head(key: string) {
    try {
      const { s3, client } = await this.sdk();
      const res = await client.send(new s3.HeadObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      return ok<ObjectMeta>({
        key,
        size: res.ContentLength ?? 0,
        contentType: res.ContentType ?? 'application/octet-stream',
        etag: (res.ETag ?? '').replaceAll('"', ''),
        lastModified: (res.LastModified ?? new Date()).toISOString(),
      });
    } catch (e) {
      const f = this.classify(e);
      return f.class === 'not_found' ? ok(null) : err(f);
    }
  }

  async createSignedUploadUrl(input: { key: string; contentType: string; expiresInSeconds?: number; maxBytes?: number }) {
    if (!isValidKey(input.key)) return err(failure(this.name, 'bad_request', 'Invalid storage key.'));
    try {
      const { s3, presign, client } = await this.sdk();
      const expiresIn = input.expiresInSeconds ?? 900;
      const url = await presign.getSignedUrl(client, new s3.PutObjectCommand({ Bucket: this.opts.bucket, Key: input.key, ContentType: input.contentType, ...(input.maxBytes ? { ContentLength: input.maxBytes } : {}) }), { expiresIn });
      return ok({ url, method: 'PUT' as const, headers: { 'Content-Type': input.contentType }, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() });
    } catch (e) {
      return err(this.classify(e));
    }
  }

  async createSignedReadUrl(input: { key: string; expiresInSeconds?: number }) {
    if (!isValidKey(input.key)) return err(failure(this.name, 'bad_request', 'Invalid storage key.'));
    try {
      const { s3, presign, client } = await this.sdk();
      const expiresIn = input.expiresInSeconds ?? 3600;
      const url = await presign.getSignedUrl(client, new s3.GetObjectCommand({ Bucket: this.opts.bucket, Key: input.key }), { expiresIn });
      return ok({ url, method: 'GET' as const, headers: {}, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() });
    } catch (e) {
      return err(this.classify(e));
    }
  }

  async initiateMultipartUpload(input: { key: string; contentType: string }) {
    try {
      const { s3, client } = await this.sdk();
      const res = await client.send(new s3.CreateMultipartUploadCommand({ Bucket: this.opts.bucket, Key: input.key, ContentType: input.contentType }));
      if (!res.UploadId) return err(failure(this.name, 'malformed_response', 'Storage did not start the upload.'));
      return ok({ uploadId: res.UploadId });
    } catch (e) {
      return err(this.classify(e));
    }
  }

  async signMultipartPart(input: { key: string; uploadId: string; partNumber: number; expiresInSeconds?: number }) {
    try {
      const { s3, presign, client } = await this.sdk();
      const expiresIn = input.expiresInSeconds ?? 900;
      const url = await presign.getSignedUrl(client, new s3.UploadPartCommand({ Bucket: this.opts.bucket, Key: input.key, UploadId: input.uploadId, PartNumber: input.partNumber }), { expiresIn });
      return ok({ url, method: 'PUT' as const, headers: {}, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() });
    } catch (e) {
      return err(this.classify(e));
    }
  }

  async completeMultipartUpload(input: { key: string; uploadId: string; parts: MultipartPart[] }) {
    try {
      const { s3, client } = await this.sdk();
      await client.send(new s3.CompleteMultipartUploadCommand({
        Bucket: this.opts.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        MultipartUpload: { Parts: input.parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      }));
      const meta = await this.head(input.key);
      if (!meta.ok) return meta;
      if (!meta.value) return err(failure(this.name, 'malformed_response', 'Upload completed but the file is missing.'));
      return ok(meta.value);
    } catch (e) {
      return err(this.classify(e));
    }
  }

  async abortMultipartUpload(input: { key: string; uploadId: string }) {
    try {
      const { s3, client } = await this.sdk();
      await client.send(new s3.AbortMultipartUploadCommand({ Bucket: this.opts.bucket, Key: input.key, UploadId: input.uploadId }));
      return ok(undefined);
    } catch (e) {
      return err(this.classify(e));
    }
  }
}
