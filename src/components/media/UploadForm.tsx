'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MyUploadItem } from '@/capabilities/media';
import { callCapability } from './capabilityClient';
import { describeJob, Uploader, type UploadJob } from './uploader';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov';

/** Unfinished sessions from a previous page load, read from sessionStorage as an external store (no setState in effects, SSR-safe). */
const EMPTY: ReturnType<typeof Uploader.pendingSessions> = [];
const pendingStore = (() => {
  let snapshot: ReturnType<typeof Uploader.pendingSessions> | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => (snapshot ??= Uploader.pendingSessions(typeof window !== 'undefined' ? window.sessionStorage : null)),
    getServer: () => EMPTY,
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    refresh: () => {
      snapshot = undefined;
      listeners.forEach((cb) => cb());
    },
  };
})();

function bytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 ** 2).toFixed(n >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * The QR upload page body: pick or drop several files, watch each one's progress, retry after an
 * interruption (parts already sent are kept), cancel, and see when the copies are ready.
 */
export function UploadForm({ collection, myUploadsHref }: { collection?: string; myUploadsHref: string }) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const pending = useSyncExternalStore(pendingStore.subscribe, pendingStore.get, pendingStore.getServer);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploader = useMemo(() => new Uploader({ collection, onChange: setJobs, storage: typeof window !== 'undefined' ? window.sessionStorage : null }), [collection]);

  // One object URL per file for its lifetime: created when the file is added (event handler), revoked on remove/unmount.
  const [previews, setPreviews] = useState<Map<string, string | null>>(() => new Map());
  const previewUrls = useRef(new Map<string, string | null>());
  const rememberPreviews = (added: UploadJob[]) => {
    for (const job of added) previewUrls.current.set(job.clientRef, job.file.type.startsWith('image/') && !/hei[cf]/i.test(job.file.type) ? URL.createObjectURL(job.file) : null);
    setPreviews(new Map(previewUrls.current));
  };
  const forgetPreview = (clientRef: string) => {
    const url = previewUrls.current.get(clientRef);
    if (url) URL.revokeObjectURL(url);
    previewUrls.current.delete(clientRef);
    setPreviews(new Map(previewUrls.current));
  };
  useEffect(() => {
    const cache = previewUrls.current;
    return () => cache.forEach((u) => u && URL.revokeObjectURL(u));
  }, []);

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const files = Array.from(list);
      if (files.length === 0) return;
      const adopted: File[] = [];
      const added: UploadJob[] = [];
      for (const file of files) {
        const session = pending.find((s) => s.filename === file.name && s.size === file.size);
        if (session) {
          added.push(uploader.adopt(file, session));
          adopted.push(file);
        }
      }
      if (adopted.length) pendingStore.refresh();
      added.push(...uploader.add(files.filter((f) => !adopted.includes(f))));
      rememberPreviews(added);
    },
    [uploader, pending],
  );

  // Poll the server while anything is still being checked/prepared.
  const processing = jobs.filter((j) => j.state === 'processing').length;
  useEffect(() => {
    if (processing === 0) return;
    let stopped = false;
    const tick = async () => {
      const r = await callCapability<{ items: MyUploadItem[] }>('list_my_uploads', { limit: 60 });
      if (stopped || !r.ok) return;
      const ready = new Set(r.data.items.filter((i) => i.assetId && i.assetStatus && !['quarantined', 'validating', 'processing'].includes(i.assetStatus) && i.assetStatus !== 'rejected').map((i) => i.assetId!));
      const rejected = new Map(r.data.items.filter((i) => i.assetStatus === 'rejected' && i.assetId).map((i) => [i.assetId!, i.rejectionReason ?? 'This one could not be added.']));
      uploader.markProcessed(ready, rejected);
    };
    const timer = setInterval(() => void tick(), 2500);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [processing, uploader]);

  const done = jobs.filter((j) => j.state === 'done' || j.state === 'duplicate').length;
  const errors = jobs.filter((j) => j.state === 'error').length;
  const active = jobs.filter((j) => ['queued', 'preparing', 'uploading', 'finishing'].includes(j.state)).length;

  return (
    <div>
      <div
        className={`media-dropzone${dragging ? ' media-dropzone--active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <label htmlFor="media-files" className="media-button">
          Choose photos or videos
        </label>
        <input
          id="media-files"
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <p className="media-dropzone__hint">JPEG, PNG, WebP, HEIC · MP4, MOV. You can pick several at once. Uploads that get interrupted can be resumed.</p>
      </div>

      {pending.length > 0 ? (
        <div className="media-summary" role="status">
          <p>
            {pending.length === 1 ? 'One upload' : `${pending.length} uploads`} from earlier did not finish. Pick the same {pending.length === 1 ? 'file' : 'files'} again and we will continue where they stopped.
          </p>
        </div>
      ) : null}

      {jobs.length > 0 ? (
        <ul className="media-upload-list" aria-label="Your uploads" aria-live="polite">
          {jobs.map((job) => {
            const preview = previews.get(job.clientRef) ?? null;
            const tone = job.state === 'error' ? 'error' : undefined;
            const busy = ['queued', 'preparing', 'uploading', 'finishing'].includes(job.state);
            return (
              <li key={job.clientRef} className="media-upload-row" data-state={job.state} data-testid="upload-row">
                {preview ? <img className="media-upload-row__preview" src={preview} alt="" width={56} height={56} /> : <span className="media-upload-row__preview media-upload-row__preview--video" aria-hidden="true">{job.file.type.startsWith('video/') ? 'video' : 'photo'}</span>}
                <div>
                  <p className="media-upload-row__name">{job.file.name}</p>
                  <p className="media-upload-row__meta" data-tone={tone}>
                    {bytes(job.file.size)} · <span data-testid="upload-status">{describeJob(job)}</span>
                  </p>
                  {busy || job.state === 'error' ? <progress className="media-progress" value={Math.round(job.progress * 100)} max={100} aria-label={`${job.file.name} upload progress`} /> : null}
                </div>
                <div className="media-upload-row__actions media-actions">
                  {job.state === 'error' ? (
                    <button type="button" className="media-button media-button--secondary" onClick={() => void uploader.retry(job.clientRef)}>
                      Retry
                    </button>
                  ) : null}
                  {busy || job.state === 'error' ? (
                    <button type="button" className="media-button media-button--quiet" onClick={() => void uploader.cancel(job.clientRef)}>
                      Cancel
                    </button>
                  ) : null}
                  {job.state === 'cancelled' || job.state === 'done' || job.state === 'duplicate' ? (
                    <button
                      type="button"
                      className="media-button media-button--quiet"
                      onClick={() => {
                        forgetPreview(job.clientRef);
                        uploader.remove(job.clientRef);
                      }}
                    >
                      Remove from list
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {jobs.length > 0 ? (
        <div className="media-summary" role="status" data-testid="upload-summary">
          <p>
            {active > 0 ? `${active} uploading · ` : ''}
            {processing > 0 ? `${processing} being prepared · ` : ''}
            {done > 0 ? `${done} done · ` : ''}
            {errors > 0 ? `${errors} need a retry` : ''}
            {active === 0 && processing === 0 && errors === 0 ? 'All done. Sara and Tyler will review before anything is shared.' : ''}
          </p>
          <p>
            <Link className="media-link" href={myUploadsHref}>
              See everything you have added
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  );
}
