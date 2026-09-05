'use client';

import { useState } from 'react';
import type { GalleryItem } from '@/capabilities/media';
import { callCapability } from './capabilityClient';
import { StatusBadge } from './MediaShell';

type ClusterItem = GalleryItem & { status: string; createdAt: string };
export interface Cluster {
  kind: 'exact' | 'near';
  key: string;
  items: ClusterItem[];
}

/** Duplicate clusters with a one-click "keep the first, reject the rest" per cluster. */
export function DuplicateClusters({ clusters: initial }: { clusters: Cluster[] }) {
  const [clusters, setClusters] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const collapse = async (cluster: Cluster) => {
    const rest = cluster.items.slice(1).filter((i) => i.status !== 'rejected' && i.status !== 'deleted').map((i) => i.id);
    if (rest.length === 0) return;
    setBusy(cluster.key);
    const r = await callCapability<{ results: { ok: boolean }[] }>('admin_moderate_media', { assetIds: rest, action: 'reject', reason: `duplicate (${cluster.kind}) of ${cluster.items[0]!.id}` }, { mutation: true });
    setBusy(null);
    if (!r.ok) return setNotice(r.error.message);
    setNotice(`Rejected ${r.data.results.filter((x) => x.ok).length} duplicate${rest.length === 1 ? '' : 's'}; kept the earliest.`);
    setClusters((cs) => cs.filter((c) => c.key !== cluster.key));
  };

  if (clusters.length === 0) {
    return (
      <div className="media-empty" role="status">
        <p>No duplicates found.</p>
      </div>
    );
  }
  return (
    <div>
      {notice ? (
        <p role="status" className="media-note">
          {notice}
        </p>
      ) : null}
      {clusters.map((cluster) => (
        <section key={cluster.key} className="media-cluster" aria-label={`${cluster.kind} duplicate cluster`}>
          <p className="media-upload-row__name">
            {cluster.kind === 'exact' ? 'Identical files' : 'Near-identical images'} · {cluster.items.length} items <StatusBadge label={cluster.kind} />
          </p>
          <ul className="media-grid">
            {cluster.items.map((item, idx) => (
              <li key={item.id}>
                <div className="media-tile" style={{ aspectRatio: '1 / 1' }}>
                  {item.thumb ? <img src={item.thumb.url} alt={item.altText ?? item.caption ?? `Item ${idx + 1}`} width={96} height={96} loading="lazy" decoding="async" /> : <span className="media-tile__placeholder">No preview</span>}
                  <span className="media-tile__badge">{idx === 0 ? 'keep' : item.status}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="media-actions">
            <button type="button" className="media-button media-button--secondary" disabled={busy === cluster.key} onClick={() => void collapse(cluster)}>
              Keep the earliest, reject the rest
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
