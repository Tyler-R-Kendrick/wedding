'use client';

import { useEffect, useRef, useState } from 'react';
import type { GalleryItem } from '@/capabilities/media';
import { AdminFlow } from '@/components/admin/flow/AdminFlow';
import { CheckField, ChoiceField, Consequences } from '@/components/admin/flow/fields';
import { RecordList, RecordRow } from '@/components/admin/flow/records';
import { callCapability, newIdempotencyKey } from '@/components/handoff/client';
import { formatStamp } from '@/components/admin/flow/dates';
import './admin-media.css';

type ClusterItem = GalleryItem & { status: string; createdAt: string };
export interface Cluster {
  kind: 'exact' | 'near';
  key: string;
  items: ClusterItem[];
}

const when = (at: string) => formatStamp(at);
const live = (i: ClusterItem) => i.status !== 'rejected' && i.status !== 'deleted';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const kindLabel = (c: Cluster) => (c.kind === 'exact' ? 'Identical files' : 'Near-identical images');

/** The cluster's items as numbered thumbnails: "Item 2" in the flow is the second one here. */
function Strip({ cluster, keep }: { cluster: Cluster; keep?: string }) {
  return (
    <ol className="dc-strip" role="list">
      {cluster.items.map((item, idx) => (
        <li key={item.id} data-keep={keep === item.id ? '' : undefined} data-out={live(item) ? undefined : ''}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL; next/image cannot sign it */}
          {item.thumb ? <img src={item.thumb.url} alt={item.altText ?? item.caption ?? ''} width={96} height={96} loading="lazy" decoding="async" /> : <span className="dc-none">No preview</span>}
          <span className="dc-label">
            Item {idx + 1}
            {keep === item.id ? ', kept' : live(item) ? '' : `, ${item.status}`}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Duplicate clusters, one row each: what kind of match, when the copies arrived, their thumbnails,
 * and one action.
 *
 * "Keep the earliest, reject the rest" was a one-click button that rejected on the spot. It is a
 * danger flow now (`AdminFlow tone="danger"`): choose which copy to keep (the earliest is chosen for
 * you), read what happens to the others, confirm. Rejecting is reversible from the queue, and the
 * flow says so. Clusters with nothing left to reject are folded away at the bottom.
 */
export function DuplicateClusters({ clusters }: { clusters: Cluster[] }) {
  const open = clusters.filter((c) => c.items.filter(live).length > 1);
  const resolved = clusters.filter((c) => c.items.filter(live).length <= 1);
  // A dealt-with cluster leaves the list when the page refreshes, and its row (with the flow's own
  // announcement and the button that had focus) goes with it. The list says what happened instead.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice && (document.activeElement === document.body || !document.activeElement)) noticeRef.current?.focus();
  }, [clusters, notice]);

  return (
    <>
      <p ref={noticeRef} tabIndex={-1} className="am-notice" role="status">
        {notice}
      </p>
      <RecordList label="Duplicate clusters" empty={open.length === 0 ? (clusters.length ? 'Every duplicate has been dealt with.' : 'No duplicates found.') : null}>
        {open.map((cluster, n) => {
          const active = cluster.items.filter(live);
          const out = cluster.items.length - active.length;
          const first = cluster.items[0]!;
          const last = cluster.items[cluster.items.length - 1]!;
          return (
            <RecordRow
              key={cluster.key}
              data-cluster-key={cluster.key}
              title={`${kindLabel(cluster)}, group ${n + 1}`}
              status={<span className="con-pill con-pill--neutral">{plural(cluster.items.length, 'item')}</span>}
              meta={
                <>
                  Added {when(first.createdAt)}
                  {cluster.items.length > 1 ? ` to ${when(last.createdAt)}` : ''}
                  {out ? ` · ${out} already rejected` : ''}
                </>
              }
              actions={<CollapseFlow cluster={cluster} n={n + 1} onDone={setNotice} />}
            >
              <Strip cluster={cluster} />
            </RecordRow>
          );
        })}
      </RecordList>
      {resolved.length ? (
        <details className="flow-details">
          <summary>Dealt with ({resolved.length})</summary>
          <div className="flow-details__body">
            {resolved.map((cluster) => (
              <div key={cluster.key}>
                <p className="flow-row__meta">
                  {kindLabel(cluster)} · checksum {cluster.key}
                </p>
                <Strip cluster={cluster} keep={cluster.items.find(live)?.id} />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

interface CollapseValues extends Record<string, unknown> {
  keepId: string;
  confirmed: boolean;
}

function CollapseFlow({ cluster, n, onDone }: { cluster: Cluster; n: number; onDone: (message: string) => void }) {
  const active = cluster.items.filter(live);
  const label = (id: string) => `Item ${cluster.items.findIndex((i) => i.id === id) + 1}`;
  const name = `${kindLabel(cluster).toLowerCase()}, group ${n}`;
  const rest = (keepId: string) => active.filter((i) => i.id !== keepId);
  return (
    <AdminFlow<CollapseValues>
      id={`media:duplicates:${cluster.key}`}
      tone="danger"
      title={`Reject the duplicates in ${name}`}
      trigger={{ label: 'Reject duplicates', variant: 'danger', accessibleName: `Reject the duplicates in ${name}` }}
      initial={{ keepId: active[0]?.id ?? '', confirmed: false }}
      steps={[
        {
          title: 'Which one do you keep?',
          lede: 'The earliest is chosen for you. The others are rejected.',
          fields: ['keepId'],
          render: (ctx) => (
            <>
              <Strip cluster={cluster} keep={ctx.values.keepId} />
              <ChoiceField
                ctx={ctx}
                name="keepId"
                legend="Keep"
                choices={active.map((i, idx) => ({
                  value: i.id,
                  label: label(i.id),
                  description: `Added ${when(i.createdAt)}, ${i.status === 'private' ? 'awaiting review' : i.status}${idx === 0 ? ' · the earliest' : ''}`,
                }))}
              />
            </>
          ),
          ready: (v) => Boolean(v.keepId),
          readyHint: { field: 'keepId', message: 'Choose the one to keep.' },
        },
        {
          title: 'Reject the others?',
          fields: ['confirmed'],
          render: (ctx) => {
            const others = rest(ctx.values.keepId);
            return (
              <>
                <Consequences>
                  <p>
                    {others.map((i) => label(i.id)).join(', ')} {others.length === 1 ? 'is' : 'are'} rejected: taken out of the queue and never shown in the gallery, and
                    anything already published comes down. {label(ctx.values.keepId)} stays as it is.
                  </p>
                  <p>To undo it, open the queue’s Rejected filter and restore {others.length === 1 ? 'it' : 'them'}.</p>
                </Consequences>
                <CheckField ctx={ctx} name="confirmed" label={`Yes, reject ${plural(others.length, 'duplicate')}`} />
              </>
            );
          },
          ready: (v) => v.confirmed,
          readyHint: { field: 'confirmed', message: 'Tick the box to confirm.' },
        },
      ]}
      submit={{
        label: (v) => `Reject ${plural(rest(v.keepId).length, 'duplicate')} in ${name}`,
        success: 'Duplicates rejected; one copy kept.',
        run: async (v) => {
          const others = rest(v.keepId);
          const r = await callCapability<{ results: { ok: boolean; message?: string }[] }>('admin_moderate_media', {
            input: { assetIds: others.map((i) => i.id), action: 'reject', reason: `duplicate (${cluster.kind}) of ${v.keepId}` },
            idempotencyKey: newIdempotencyKey(),
          });
          if (r.ok && r.data) {
            const done = r.data.results.filter((x) => x.ok).length;
            const skipped = r.data.results.length - done;
            onDone(`${name[0]!.toUpperCase()}${name.slice(1)}: kept ${label(v.keepId).toLowerCase()}, rejected ${plural(done, 'duplicate')}${skipped ? `; ${skipped} could not be rejected (${[...new Set(r.data.results.filter((x) => !x.ok).map((x) => x.message))].join('; ')})` : ''}.`);
          }
          return r;
        },
      }}
    />
  );
}
