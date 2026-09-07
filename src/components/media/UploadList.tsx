'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { MyUploadItem } from '@/capabilities/media';
import { callCapability } from './capabilityClient';
import { StatusBadge } from './MediaShell';

function bytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 ** 2).toFixed(n >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** "My uploads": every file the guest added, its state in plain words, and a delete control for their own items. */
export function UploadList({ items: initial, uploadHref }: { items: MyUploadItem[]; uploadHref: string }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (item: MyUploadItem) => {
    if (!item.assetId) return;
    if (!window.confirm('Delete this from the wedding site? This removes the original and every copy.')) return;
    setBusy(item.assetId);
    setError(null);
    const r = await callCapability<{ deleted: boolean }>('delete_my_upload', { assetId: item.assetId }, { mutation: true });
    setBusy(null);
    if (!r.ok) return setError(r.error.message);
    setItems((list) => list.filter((i) => i.assetId !== item.assetId));
  };

  if (items.length === 0) {
    return (
      <div className="media-empty" role="status">
        <p>
          You have not added anything yet.{' '}
          <Link className="media-link" href={uploadHref}>
            Add photos or videos
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <>
      {error ? (
        <p className="media-upload-row__meta" data-tone="error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="media-upload-list" aria-label="Your uploads">
        {items.map((item) => (
          <li key={item.uploadId} className="media-upload-row" data-testid="my-upload" data-asset-status={item.assetStatus ?? item.uploadStatus}>
            {item.thumb ? <img className="media-upload-row__preview" src={item.thumb.url} alt="" width={56} height={56} loading="lazy" decoding="async" /> : <span className="media-upload-row__preview media-upload-row__preview--video" aria-hidden="true">{item.kind}</span>}
            <div>
              <p className="media-upload-row__name">{item.filename}</p>
              <p className="media-upload-row__meta">
                <StatusBadge label={item.label} /> {item.hint}
              </p>
              <p className="media-upload-row__meta">
                {bytes(item.bytes)} · added {new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {item.caption ? ` · “${item.caption}”` : ''}
              </p>
              {item.rejectionReason ? (
                <p className="media-upload-row__meta" data-tone="error">
                  {item.rejectionReason}
                </p>
              ) : null}
            </div>
            <div className="media-upload-row__actions media-actions">
              {item.canResume ? (
                <Link className="media-button media-button--secondary" href={uploadHref}>
                  Resume on the upload page
                </Link>
              ) : null}
              {item.canDelete ? (
                <button type="button" className="media-button media-button--danger" onClick={() => void remove(item)} disabled={busy === item.assetId}>
                  {busy === item.assetId ? 'Deleting' : 'Delete'}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
