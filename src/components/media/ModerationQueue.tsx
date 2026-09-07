'use client';

import { useCallback, useState } from 'react';
import type { CollectionSummary, QueueItem } from '@/capabilities/media';
import { ASSET_STATUSES, MODERATION_ACTIONS, type AssetStatus, type ModerationAction } from '@/db/schema/media';
import { callCapability } from './capabilityClient';
import { StatusBadge } from './MediaShell';

interface QueueResponse {
  items: QueueItem[];
  collections: CollectionSummary[];
  nextCursor?: string;
}

const ACTION_LABEL: Record<ModerationAction, string> = {
  approve: 'Approve and publish',
  reject: 'Reject',
  hide: 'Hide',
  unhide: 'Unhide',
  report: 'Flag for follow-up',
  reprocess: 'Reprocess',
  delete: 'Delete',
  restore: 'Restore',
};

function bytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Moderation queue: filter by state/album/kind, select many, act in bulk. Every action is one
 * admin_moderate_media call; results are applied per item so partial failures stay visible.
 */
export function ModerationQueue({ initial, initialStatus }: { initial: QueueResponse; initialStatus: AssetStatus }) {
  const [data, setData] = useState<QueueResponse>(initial);
  const [status, setStatus] = useState<AssetStatus>(initialStatus);
  const [collection, setCollection] = useState<string>('');
  const [kind, setKind] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  type Filters = { status: AssetStatus; collection: string; kind: string };
  const load = useCallback(async (filters: Filters, cursor?: string) => {
    setBusy(true);
    const r = await callCapability<QueueResponse>('admin_list_media', { status: filters.status, ...(filters.collection ? { collection: filters.collection } : {}), ...(filters.kind ? { kind: filters.kind } : {}), ...(cursor ? { cursor } : {}), limit: 50 });
    setBusy(false);
    if (!r.ok) return setNotice(r.error.message);
    setData((prev) => (cursor ? { ...r.data, items: [...prev.items, ...r.data.items] } : r.data));
    if (!cursor) setSelected(new Set());
  }, []);
  const filters: Filters = { status, collection, kind };
  const applyFilters = (next: Partial<Filters>) => {
    const merged = { ...filters, ...next };
    setStatus(merged.status);
    setCollection(merged.collection);
    setKind(merged.kind);
    void load(merged);
  };

  const act = async (action: ModerationAction, ids: string[]) => {
    if (ids.length === 0) return;
    if ((action === 'delete' || action === 'reject') && !window.confirm(`${ACTION_LABEL[action]} ${ids.length} item${ids.length === 1 ? '' : 's'}?`)) return;
    setBusy(true);
    setNotice(null);
    const r = await callCapability<{ results: { assetId: string; ok: boolean; status?: string; message?: string }[] }>('admin_moderate_media', { assetIds: ids, action, ...(reason.trim() ? { reason: reason.trim() } : {}) }, { mutation: true });
    setBusy(false);
    if (!r.ok) return setNotice(r.error.message);
    const failed = r.data.results.filter((x) => !x.ok);
    setNotice(failed.length ? `${r.data.results.length - failed.length} done, ${failed.length} skipped: ${failed.map((f) => f.message).join('; ')}` : `${ACTION_LABEL[action]}: ${r.data.results.length} done.`);
    await load(filters);
  };

  const toggleAll = (on: boolean) => setSelected(on ? new Set(data.items.map((i) => i.id)) : new Set());
  const allowed = MODERATION_ACTIONS.filter((a) => a !== 'restore' || status === 'rejected' || status === 'deleted');

  return (
    <div>
      <div className="media-filters">
        <label className="media-field">
          <span>State</span>
          <select value={status} onChange={(e) => applyFilters({ status: e.target.value as AssetStatus })}>
            {ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="media-field">
          <span>Album</span>
          <select value={collection} onChange={(e) => applyFilters({ collection: e.target.value })}>
            <option value="">All albums</option>
            {data.collections.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="media-field">
          <span>Kind</span>
          <select value={kind} onChange={(e) => applyFilters({ kind: e.target.value })}>
            <option value="">Photos and videos</option>
            <option value="image">Photos</option>
            <option value="video">Videos</option>
          </select>
        </label>
        <label className="media-field">
          <span>Reason (optional, logged)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
      </div>

      <div className="media-bulk" role="toolbar" aria-label="Bulk actions">
        <label className="media-actions">
          <input type="checkbox" checked={selected.size > 0 && selected.size === data.items.length} onChange={(e) => toggleAll(e.target.checked)} aria-label="Select all" />
          <span>{selected.size} selected</span>
        </label>
        {allowed.map((a) => (
          <button key={a} type="button" className={`media-button ${a === 'approve' ? '' : a === 'delete' || a === 'reject' ? 'media-button--danger' : 'media-button--secondary'}`} disabled={busy || selected.size === 0} onClick={() => void act(a, [...selected])} data-action={a}>
            {ACTION_LABEL[a]}
          </button>
        ))}
      </div>
      {notice ? (
        <p role="status" className="media-note">
          {notice}
        </p>
      ) : null}

      {data.items.length === 0 ? (
        <div className="media-empty" role="status">
          <p>Nothing {status === 'private' ? 'awaiting review' : `in "${status}"`} right now.</p>
        </div>
      ) : (
        <ul className="media-queue" aria-label="Media queue">
          {data.items.map((item) => (
            <li key={item.id} className="media-queue-row" data-testid="queue-item" data-asset-id={item.id}>
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={(e) => setSelected((s) => {
                  const next = new Set(s);
                  if (e.target.checked) next.add(item.id);
                  else next.delete(item.id);
                  return next;
                })}
                aria-label={`Select ${item.originalFilename ?? item.id}`}
              />
              {item.thumb ? <img className="media-queue-row__thumb" src={item.thumb.url} alt={item.altText ?? item.caption ?? ''} width={96} height={96} loading="lazy" decoding="async" /> : <span className="media-queue-row__thumb" aria-hidden="true" />}
              <div>
                <p className="media-upload-row__name">
                  {item.originalFilename ?? item.id} <StatusBadge label={item.status} /> {item.kind === 'video' ? <StatusBadge label="video" /> : null}
                  {item.reportCount > 0 ? <StatusBadge label={`flagged ×${item.reportCount}`} /> : null}
                </p>
                <dl>
                  <dt>Album</dt>
                  <dd>{item.collection.title}</dd>
                  <dt>From</dt>
                  <dd>{item.uploader.kind === 'guest' ? `guest ${item.uploader.guestId}` : item.uploader.kind === 'admin' ? `admin ${item.uploader.adminId}` : item.uploader.kind}</dd>
                  <dt>File</dt>
                  <dd>
                    {item.contentType} · {bytes(item.bytes)} · {item.width && item.height ? `${item.width}×${item.height}` : 'size unknown'}
                  </dd>
                  <dt>Captured</dt>
                  <dd>
                    {item.capturedAt ? new Date(item.capturedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' }) : 'unknown'}
                    {item.camera ? ` · ${item.camera}` : ''}
                    {item.hadLocation ? ' · location removed' : ''}
                  </dd>
                  {item.caption ? (
                    <>
                      <dt>Caption</dt>
                      <dd>{item.caption}</dd>
                    </>
                  ) : null}
                  {item.qualitySignals ? (
                    <>
                      <dt>Signals</dt>
                      <dd>
                        sharpness {item.qualitySignals.sharpness ?? '–'} · luma {item.qualitySignals.meanLuma ?? '–'} · clipped highlights {Math.round((item.qualitySignals.clippedHighlights ?? 0) * 100)}%
                      </dd>
                    </>
                  ) : null}
                  {item.duplicateOfAssetId ? (
                    <>
                      <dt>Duplicate of</dt>
                      <dd>{item.duplicateOfAssetId}</dd>
                    </>
                  ) : null}
                  {item.rights ? (
                    <>
                      <dt>Rights</dt>
                      <dd>
                        {item.rights.vendorName} · © {item.rights.copyrightHolder} · {item.rights.licenseNote} · AI processing {item.rights.allowAiProcessing ? 'permitted' : 'not permitted'} · publication {item.rights.publicationApproved ? 'approved' : 'pending'}
                      </dd>
                    </>
                  ) : null}
                  {item.processingError ? (
                    <>
                      <dt>Note</dt>
                      <dd>{item.processingError}</dd>
                    </>
                  ) : null}
                </dl>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data.nextCursor ? (
        <div className="media-pager">
          <button type="button" className="media-button media-button--secondary" disabled={busy} onClick={() => void load(filters, data.nextCursor)}>
            Show more
          </button>
        </div>
      ) : null}
    </div>
  );
}
