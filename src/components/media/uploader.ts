import { newId } from '@/contracts/ids';
import { callCapability, type CapabilityResponse } from './capabilityClient';

/**
 * Framework-free upload engine for the QR upload page. One job per file:
 *   fingerprint -> create ticket -> PUT parts (progress, bounded automatic retries) -> complete
 * Interrupted jobs keep their part ETags (also in sessionStorage) so `resume` re-signs only what
 * is missing. The transport is injectable so the engine can be tested without a browser.
 */
export type JobState = 'queued' | 'preparing' | 'uploading' | 'finishing' | 'processing' | 'done' | 'duplicate' | 'error' | 'cancelled';

export interface UploadJob {
  clientRef: string;
  file: File;
  state: JobState;
  /** 0..1 of bytes sent. */
  progress: number;
  message?: string;
  uploadId?: string;
  assetId?: string;
  ticket?: Ticket;
  parts: Record<number, string>;
  attempts: number;
  caption?: string;
}

export interface TicketPart {
  partNumber: number;
  url?: string;
  headers: Record<string, string>;
  uploaded: boolean;
}

export interface Ticket {
  uploadId: string;
  clientRef: string;
  mode: 'single' | 'multipart';
  partSize: number;
  partCount: number;
  parts: TicketPart[];
  expiresAt: string;
}

type CreateResponse = { uploads: { clientRef: string; ok: boolean; ticket?: Ticket; duplicateOf?: { assetId: string; status: string }; error?: { message: string } }[] };
type CompleteResponse = { assetId: string; status: string };

export interface PutResult {
  etag: string;
}

/** PUTs one blob to a signed URL, reporting sent bytes. Rejects on network/HTTP failure. */
export type PartTransport = (input: { url: string; headers: Record<string, string>; body: Blob; onProgress: (sent: number) => void; signal?: AbortSignal }) => Promise<PutResult>;

export interface UploaderApi {
  create(files: { clientRef: string; filename: string; contentType: string; size: number; fingerprint?: string; caption?: string }[], collection?: string): Promise<CapabilityResponse<CreateResponse>>;
  resume(uploadId: string, uploadedParts: { partNumber: number; etag: string }[]): Promise<CapabilityResponse<Ticket>>;
  complete(uploadId: string, parts: { partNumber: number; etag: string }[], caption?: string, idempotencyKey?: string): Promise<CapabilityResponse<CompleteResponse>>;
  abort(uploadId: string): Promise<CapabilityResponse<unknown>>;
}

/** Default API: the /api/uploads/* aliases (same pipeline as /api/capabilities/*). */
export const defaultApi: UploaderApi = {
  create: (files, collection) => callCapability('create_upload', { files, ...(collection ? { collection } : {}) }, { mutation: true, path: '/api/uploads/create' }),
  resume: (uploadId, uploadedParts) => callCapability('resume_upload', { uploadId, uploadedParts }, { path: '/api/uploads/resume' }),
  complete: (uploadId, parts, caption, idempotencyKey) => callCapability('complete_upload', { uploadId, parts, ...(caption ? { caption } : {}) }, { mutation: true, idempotencyKey, path: '/api/uploads/complete' }),
  abort: (uploadId) => callCapability('abort_upload', { uploadId }, { mutation: true, path: '/api/uploads/abort' }),
};

/** XHR gives upload progress events; fetch does not. */
export const xhrTransport: PartTransport = ({ url, headers, body, onProgress, signal }) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve({ etag: (xhr.getResponseHeader('ETag') ?? '').replaceAll('"', '') });
      else reject(new Error(`upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.onabort = () => reject(new Error('aborted'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(body);
  });

const HEAD = 256 * 1024;
const TAIL = 64 * 1024;

/** Mirrors src/lib/media/checksum.ts quickFingerprint: sha256(size || first 256 KiB || last 64 KiB). */
export async function fingerprintFile(file: File, subtle: SubtleCrypto | null | undefined = globalThis.crypto?.subtle): Promise<string | undefined> {
  if (!subtle) return undefined;
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, HEAD)).arrayBuffer());
  const tail = file.size > HEAD ? new Uint8Array(await file.slice(Math.max(HEAD, file.size - TAIL)).arrayBuffer()) : new Uint8Array();
  const sizeBytes = new TextEncoder().encode(String(file.size));
  const all = new Uint8Array(sizeBytes.byteLength + head.byteLength + tail.byteLength);
  all.set(sizeBytes, 0);
  all.set(head, sizeBytes.byteLength);
  all.set(tail, sizeBytes.byteLength + head.byteLength);
  const digest = await subtle.digest('SHA-256', all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface UploaderOptions {
  api?: UploaderApi;
  transport?: PartTransport;
  /** Automatic retries per part before the job stops and asks the guest to retry. */
  maxPartAttempts?: number;
  backoffMs?: (attempt: number) => number;
  collection?: string;
  onChange?: (jobs: UploadJob[]) => void;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  subtle?: SubtleCrypto;
  /** Concurrency across files (parts within a file run sequentially to keep memory bounded). */
  concurrency?: number;
}

const SESSION_KEY = 'media-upload-sessions';

interface PersistedSession {
  uploadId: string;
  filename: string;
  size: number;
  parts: Record<number, string>;
  caption?: string;
}

export class Uploader {
  readonly jobs: UploadJob[] = [];
  private readonly api: UploaderApi;
  private readonly transport: PartTransport;
  private readonly maxPartAttempts: number;
  private readonly backoffMs: (attempt: number) => number;
  private readonly controllers = new Map<string, AbortController>();
  private readonly opts: UploaderOptions;

  constructor(opts: UploaderOptions = {}) {
    this.opts = opts;
    this.api = opts.api ?? defaultApi;
    this.transport = opts.transport ?? xhrTransport;
    this.maxPartAttempts = opts.maxPartAttempts ?? 3;
    this.backoffMs = opts.backoffMs ?? ((attempt) => Math.min(8000, 500 * 2 ** (attempt - 1)));
  }

  private emit() {
    this.opts.onChange?.([...this.jobs]);
  }

  private update(job: UploadJob, patch: Partial<UploadJob>) {
    Object.assign(job, patch);
    this.emit();
  }

  /** Adds files to the queue and starts them. Returns the new jobs. */
  add(files: File[], captions: Record<string, string> = {}): UploadJob[] {
    const added: UploadJob[] = files.map((file) => ({ clientRef: newId(), file, state: 'queued', progress: 0, parts: {}, attempts: 0, caption: captions[file.name] }));
    this.jobs.push(...added);
    this.emit();
    void this.pump();
    return added;
  }

  private running = 0;
  private async pump() {
    const limit = this.opts.concurrency ?? 2;
    while (this.running < limit) {
      const next = this.jobs.find((j) => j.state === 'queued');
      if (!next) return;
      this.running++;
      void this.run(next).finally(() => {
        this.running--;
        void this.pump();
      });
    }
  }

  private async run(job: UploadJob) {
    try {
      this.update(job, { state: 'preparing', message: undefined });
      const fingerprint = await fingerprintFile(job.file, this.opts.subtle);
      const created = await this.api.create([{ clientRef: job.clientRef, filename: job.file.name, contentType: job.file.type, size: job.file.size, fingerprint, caption: job.caption }], this.opts.collection);
      if (!created.ok) return this.update(job, { state: 'error', message: created.error.message });
      const outcome = created.data.uploads.find((u) => u.clientRef === job.clientRef);
      if (!outcome) return this.update(job, { state: 'error', message: 'We could not start that upload.' });
      if (!outcome.ok) return this.update(job, { state: 'error', message: outcome.error?.message ?? 'That file could not be added.' });
      if (outcome.duplicateOf) return this.update(job, { state: 'duplicate', assetId: outcome.duplicateOf.assetId, progress: 1, message: 'You already added this one.' });
      job.ticket = outcome.ticket!;
      job.uploadId = job.ticket.uploadId;
      this.persist(job);
      await this.sendParts(job);
    } catch (e) {
      this.update(job, { state: 'error', message: e instanceof Error && e.message === 'aborted' ? 'Upload paused.' : 'Something interrupted the upload. Tap retry to continue.' });
    }
  }

  private async sendParts(job: UploadJob) {
    const ticket = job.ticket!;
    const controller = new AbortController();
    this.controllers.set(job.clientRef, controller);
    this.update(job, { state: 'uploading' });
    const total = job.file.size;
    const sentBefore = () => Object.keys(job.parts).reduce((n, k) => n + this.partBytes(ticket, Number(k), total), 0);
    for (const part of ticket.parts) {
      if (part.uploaded || job.parts[part.partNumber]) continue;
      if (!part.url) throw new Error('missing part url');
      const start = (part.partNumber - 1) * ticket.partSize;
      const body = ticket.mode === 'single' ? job.file : job.file.slice(start, Math.min(total, start + ticket.partSize));
      let attempt = 0;
      for (;;) {
        attempt++;
        try {
          const base = sentBefore();
          const result = await this.transport({ url: part.url, headers: part.headers, body, onProgress: (sent) => this.update(job, { progress: Math.min(1, (base + sent) / Math.max(1, total)) }), signal: controller.signal });
          job.parts[part.partNumber] = result.etag;
          this.persist(job);
          this.update(job, { progress: Math.min(1, sentBefore() / Math.max(1, total)) });
          break;
        } catch (e) {
          if (controller.signal.aborted) throw new Error('aborted');
          if (attempt >= this.maxPartAttempts) {
            this.update(job, { state: 'error', attempts: job.attempts + 1, message: 'The connection dropped. Tap retry to pick up where it stopped.' });
            return;
          }
          await new Promise((r) => setTimeout(r, this.backoffMs(attempt)));
          void e;
        }
      }
    }
    await this.finish(job);
  }

  private partBytes(ticket: Ticket, partNumber: number, total: number): number {
    if (ticket.mode === 'single') return total;
    const start = (partNumber - 1) * ticket.partSize;
    return Math.max(0, Math.min(total, start + ticket.partSize) - start);
  }

  private async finish(job: UploadJob) {
    this.update(job, { state: 'finishing', progress: 1 });
    const parts = Object.entries(job.parts).map(([n, etag]) => ({ partNumber: Number(n), etag }));
    const done = await this.api.complete(job.uploadId!, parts, job.caption, `complete-${job.uploadId}`);
    if (!done.ok) {
      if (done.error.details && Array.isArray(done.error.details['missingParts'])) return this.update(job, { state: 'error', message: 'Some parts did not arrive. Tap retry to send them again.' });
      return this.update(job, { state: 'error', message: done.error.message });
    }
    this.forget(job);
    this.update(job, { state: 'processing', assetId: done.data.assetId, message: undefined });
  }

  /** Retry after an error: re-signs missing parts through resume_upload, then continues. */
  async retry(clientRef: string): Promise<void> {
    const job = this.jobs.find((j) => j.clientRef === clientRef);
    if (!job || job.state !== 'error') return;
    if (!job.uploadId) {
      this.update(job, { state: 'queued', message: undefined, progress: 0 });
      return this.pump();
    }
    this.update(job, { state: 'preparing', message: undefined });
    const uploadedParts = Object.entries(job.parts).map(([n, etag]) => ({ partNumber: Number(n), etag }));
    const resumed = await this.api.resume(job.uploadId, uploadedParts);
    if (!resumed.ok) {
      if (resumed.error.code === 'conflict' && (resumed.error.details as { assetId?: string } | undefined)?.assetId) {
        return this.update(job, { state: 'processing', assetId: (resumed.error.details as { assetId: string }).assetId, progress: 1 });
      }
      // Expired sessions start over from scratch
      job.parts = {};
      job.uploadId = undefined;
      job.ticket = undefined;
      this.forget(job);
      this.update(job, { state: 'queued', message: undefined, progress: 0 });
      return this.pump();
    }
    job.ticket = resumed.data;
    try {
      await this.sendParts(job);
    } catch {
      this.update(job, { state: 'error', message: 'Upload paused.' });
    }
  }

  /** Marks jobs as done once the server reports them processed. */
  markProcessed(assetIds: Set<string>, rejected: Map<string, string>) {
    for (const job of this.jobs) {
      if (job.state !== 'processing' || !job.assetId) continue;
      if (rejected.has(job.assetId)) this.update(job, { state: 'error', message: rejected.get(job.assetId) });
      else if (assetIds.has(job.assetId)) this.update(job, { state: 'done' });
    }
  }

  async cancel(clientRef: string): Promise<void> {
    const job = this.jobs.find((j) => j.clientRef === clientRef);
    if (!job) return;
    this.controllers.get(clientRef)?.abort();
    if (job.uploadId && (job.state === 'uploading' || job.state === 'error' || job.state === 'preparing')) await this.api.abort(job.uploadId);
    this.forget(job);
    this.update(job, { state: 'cancelled', message: undefined });
  }

  remove(clientRef: string) {
    const idx = this.jobs.findIndex((j) => j.clientRef === clientRef);
    if (idx >= 0) this.jobs.splice(idx, 1);
    this.emit();
  }

  get processingAssetIds(): string[] {
    return this.jobs.filter((j) => j.state === 'processing' && j.assetId).map((j) => j.assetId!);
  }

  /** Sessions from a previous page load that never finished (shown so the guest can pick the file again). */
  static pendingSessions(storage: Pick<Storage, 'getItem'> | null | undefined): PersistedSession[] {
    try {
      const raw = storage?.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as PersistedSession[]) : [];
    } catch {
      return [];
    }
  }

  private readSessions(): PersistedSession[] {
    return Uploader.pendingSessions(this.opts.storage);
  }

  private writeSessions(sessions: PersistedSession[]) {
    try {
      this.opts.storage?.setItem(SESSION_KEY, JSON.stringify(sessions));
    } catch {
      // storage unavailable (private mode): resume still works within the page
    }
  }

  private persist(job: UploadJob) {
    if (!job.uploadId) return;
    const sessions = this.readSessions().filter((s) => s.uploadId !== job.uploadId);
    sessions.push({ uploadId: job.uploadId, filename: job.file.name, size: job.file.size, parts: job.parts, caption: job.caption });
    this.writeSessions(sessions);
  }

  private forget(job: UploadJob) {
    if (!job.uploadId) return;
    this.writeSessions(this.readSessions().filter((s) => s.uploadId !== job.uploadId));
  }

  /** Re-attaches a persisted session to a freshly picked file with the same name and size. */
  adopt(file: File, session: PersistedSession): UploadJob {
    const job: UploadJob = { clientRef: newId(), file, state: 'error', progress: 0, parts: { ...session.parts }, attempts: 0, uploadId: session.uploadId, caption: session.caption, message: 'Resuming...' };
    this.jobs.push(job);
    this.emit();
    void this.retry(job.clientRef);
    return job;
  }
}

export function describeJob(job: UploadJob): string {
  switch (job.state) {
    case 'queued':
      return 'Waiting';
    case 'preparing':
      return 'Getting ready';
    case 'uploading':
      return `Uploading ${Math.round(job.progress * 100)}%`;
    case 'finishing':
      return 'Finishing';
    case 'processing':
      return 'Uploaded. Checking and preparing web copies';
    case 'done':
      return 'Uploaded. Awaiting review';
    case 'duplicate':
      return job.message ?? 'Already added';
    case 'error':
      return job.message ?? 'Something went wrong';
    case 'cancelled':
      return 'Cancelled';
  }
}
