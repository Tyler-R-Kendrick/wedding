'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CollectionSummary, QueueItem } from '@/capabilities/media';
import { AdminFlow } from '@/components/admin/flow/AdminFlow';
import { CheckField, Consequences, TextField } from '@/components/admin/flow/fields';
import { callCapability, newIdempotencyKey, type CapabilityResponse } from '@/components/handoff/client';
import { MODERATION_ACTIONS, type AssetStatus, type ModerationAction } from '@/db/schema/media';
import { moderationTarget } from '@/domain/media/state';
import { ACTION_LABEL, STATUS_LABEL } from './moderation';
import './admin-media.css';

export interface QueueResponse {
  items: QueueItem[];
  collections: CollectionSummary[];
  nextCursor?: string;
}

export interface QueueFilters {
  status: AssetStatus;
  collection?: string;
  kind?: string;
}

type Results = { results: { assetId: string; ok: boolean; status?: string; message?: string }[] };

/** Reject and delete confirm first (AdminFlow tone="danger"); everything else is one click and easy to reverse. */
const DANGER: readonly ModerationAction[] = ['reject', 'delete'];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function bytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

const CAPTURED = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' });

function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad'; children: ReactNode }) {
  return <span className={`con-pill con-pill--${tone}`}>{children}</span>;
}

function summarise(action: ModerationAction, data: Results): string {
  const failed = data.results.filter((x) => !x.ok);
  if (!failed.length) return `${ACTION_LABEL[action]}: ${data.results.length} done.`;
  return `${ACTION_LABEL[action]}: ${data.results.length - failed.length} done, ${failed.length} skipped: ${[...new Set(failed.map((f) => f.message))].join('; ')}`;
}

/**
 * The moderation queue: a work tool, not a set of forms. Tick items (or "Select all"), then act on
 * them together from the bar above the list.
 *
 * - Approving, hiding, flagging, re-preparing and restoring are one click: each is undone by another
 *   click from the right filter, and the bar says what happened in words.
 * - Rejecting and deleting open a confirmation sheet (`AdminFlow tone="danger"`) that says how many
 *   items, which ones, what happens to them and how to bring them back, with an optional reason for
 *   the moderation log. They used to be `window.confirm()`, and the reason was a box beside the
 *   filters that every action — approve included — silently picked up.
 * - Filters are the page's own GET form (`FilterBar` on /admin/media), so a filtered queue is a URL.
 *
 * Every action is one `admin_moderate_media` call; results are per item, so a partial failure is
 * reported rather than lost, and the list is re-read from the server afterwards.
 */
export function ModerationQueue({ initial, filters }: { initial: QueueResponse; filters: QueueFilters }) {
  const [data, setData] = useState<QueueResponse>(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<ModerationAction | 'more' | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone?: 'error' } | null>(null);
  const allRef = useRef<HTMLInputElement>(null);

  const status = filters.status;
  const listInput = (cursor?: string) => ({ status, ...(filters.collection ? { collection: filters.collection } : {}), ...(filters.kind ? { kind: filters.kind } : {}), ...(cursor ? { cursor } : {}), limit: 50 });

  const reload = async (cursor?: string) => {
    const r = await callCapability<QueueResponse>('admin_list_media', { input: listInput(cursor) });
    if (!r.ok || !r.data) {
      setNotice({ text: r.error?.message ?? 'The queue could not be read. Reload the page.', tone: 'error' });
      return;
    }
    const next = r.data;
    setData((prev) => (cursor ? { ...next, items: [...prev.items, ...next.items] } : next));
    if (!cursor) setSelected(new Set());
  };

  const moderate = (action: ModerationAction, ids: string[], reason?: string) =>
    callCapability<Results>('admin_moderate_media', { input: { assetIds: ids, action, ...(reason ? { reason } : {}) }, idempotencyKey: newIdempotencyKey() });

  const ids = [...selected];
  const count = ids.length;
  const total = data.items.length;

  // "Select all" shows a dash when some, not all, are ticked.
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = count > 0 && count < total;
  }, [count, total]);

  const oneClick = async (action: ModerationAction) => {
    if (busy) return;
    if (!count) {
      setNotice({ text: `Tick the items to ${ACTION_LABEL[action].toLowerCase()} first.`, tone: 'error' });
      return;
    }
    setBusy(action);
    setNotice(null);
    const r = await moderate(action, ids);
    if (!r.ok || !r.data) {
      setBusy(null);
      setNotice({ text: r.error?.message ?? 'That did not save. Please try again.', tone: 'error' });
      return;
    }
    setNotice({ text: summarise(action, r.data) });
    await reload();
    setBusy(null);
  };

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Only what applies to this state: approve means nothing on a rejected item, restore nothing on a published one.
  const allowed = MODERATION_ACTIONS.filter((a) => moderationTarget(a, status) !== null);
  const primary: ModerationAction | undefined = allowed.includes('approve') ? 'approve' : allowed.includes('restore') ? 'restore' : undefined;
  const quick = allowed.filter((a) => !DANGER.includes(a));
  const danger = allowed.filter((a) => DANGER.includes(a));
  const names = data.items.filter((i) => selected.has(i.id)).map((i) => i.originalFilename ?? 'an untitled file');

  return (
    <div className="mq">
      <div className="mq-bar" role="group" aria-label="Act on the selected items">
        <label className="mq-all">
          <input ref={allRef} type="checkbox" checked={total > 0 && count === total} disabled={total === 0} onChange={(e) => setSelected(e.target.checked ? new Set(data.items.map((i) => i.id)) : new Set())} />
          <span>Select all</span>
        </label>
        <span className="mq-count" aria-live="polite">
          {count ? `${count} of ${total} selected` : 'Nothing selected'}
        </span>
        <span className="mq-actions">
          {quick.map((a) => (
            <button
              key={a}
              type="button"
              data-action={a}
              className={a === primary ? 'ops-button ops-button-primary' : 'ops-button ops-button-ghost'}
              aria-disabled={busy !== null || count === 0 || undefined}
              aria-busy={busy === a || undefined}
              onClick={() => void oneClick(a)}
            >
              {busy === a ? 'Working…' : ACTION_LABEL[a]}
            </button>
          ))}
          {danger.map((a) => (
            <DangerAction key={a} action={a} ids={ids} names={names} run={moderate} onDone={async (text) => {
              setNotice(text ? { text } : null);
              await reload();
            }} />
          ))}
        </span>
      </div>

      {notice ? (
        <p role="status" className="media-note mq-note" data-tone={notice.tone}>
          {notice.text}
        </p>
      ) : null}

      {total === 0 ? (
        <p className="flow-empty" role="status">
          Nothing {status === 'private' ? 'is awaiting review' : `is ${STATUS_LABEL[status].toLowerCase()}`}
          {filters.collection || filters.kind ? ' with these filters' : ''} right now.
        </p>
      ) : (
        <ul className="flow-rows mq-rows" aria-label="Media queue">
          {data.items.map((item) => (
            <QueueRow key={item.id} item={item} checked={selected.has(item.id)} onToggle={(on) => toggle(item.id, on)} />
          ))}
        </ul>
      )}

      {data.nextCursor ? (
        <p className="mq-more">
          <button
            type="button"
            className="ops-button ops-button-ghost"
            aria-disabled={busy !== null || undefined}
            onClick={async () => {
              if (busy) return;
              setBusy('more');
              await reload(data.nextCursor);
              setBusy(null);
            }}
          >
            {busy === 'more' ? 'Loading…' : 'Show more'}
          </button>
        </p>
      ) : null}
    </div>
  );
}

function QueueRow({ item, checked, onToggle }: { item: QueueItem; checked: boolean; onToggle: (on: boolean) => void }) {
  const name = item.originalFilename ?? 'Untitled file';
  const from = item.uploader.kind === 'guest' ? 'a guest' : item.uploader.kind === 'admin' ? (item.source === 'professional' ? 'a vendor import' : 'an admin') : item.uploader.kind;
  const status = item.status as AssetStatus;
  return (
    <li className="flow-row mq-row" data-testid="queue-item" data-asset-id={item.id} data-selected={checked ? '' : undefined}>
      <label className="mq-pick">
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
        <span className="sr-only">Select {name}</span>
      </label>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL; next/image cannot sign it */}
      {item.thumb ? <img className="mq-thumb" src={item.thumb.url} alt={item.altText ?? item.caption ?? ''} width={96} height={96} loading="lazy" decoding="async" /> : <span className="mq-thumb" aria-hidden="true" />}
      <div className="flow-row__main">
        <p className="flow-row__title">
          <span className="mq-name">{name}</span>
          <Pill tone={status === 'published' ? 'good' : status === 'failed' || status === 'rejected' ? 'bad' : 'neutral'}>{STATUS_LABEL[status] ?? status}</Pill>
          {item.kind === 'video' ? <Pill>Video</Pill> : null}
          {item.reportCount > 0 ? <Pill tone="warn">Flagged ×{item.reportCount}</Pill> : null}
        </p>
        <p className="flow-row__meta">
          {item.collection.title} · from {from} · {bytes(item.bytes)}
          {item.width && item.height ? ` · ${item.width}×${item.height}` : ''}
        </p>
        <p className="flow-row__meta">
          {item.capturedAt ? `Captured ${CAPTURED.format(new Date(item.capturedAt))}` : 'Capture time unknown'}
          {item.camera ? ` · ${item.camera}` : ''}
          {item.hadLocation ? ' · location removed' : ''}
        </p>
        {item.caption ? <p className="mq-caption">“{item.caption}”</p> : null}
        {item.rights ? (
          <p className="flow-row__meta">
            © {item.rights.copyrightHolder} · {item.rights.vendorName} · {item.rights.licenseNote} · AI processing {item.rights.allowAiProcessing ? 'permitted' : 'not permitted'} · publication{' '}
            {item.rights.publicationApproved ? 'approved' : 'not yet approved'}
          </p>
        ) : null}
        {item.processingError ? <p className="mq-problem">{item.processingError}</p> : null}
        <details className="flow-details mq-details">
          <summary>File details</summary>
          <dl className="flow-review">
            <div>
              <dt>Type</dt>
              <dd>{item.contentType}</dd>
            </div>
            {item.qualitySignals ? (
              <div>
                <dt>Signals</dt>
                <dd>
                  sharpness {item.qualitySignals.sharpness ?? '–'} · luma {item.qualitySignals.meanLuma ?? '–'} · clipped highlights {Math.round((item.qualitySignals.clippedHighlights ?? 0) * 100)}%
                </dd>
              </div>
            ) : null}
            {item.duplicateOfAssetId ? (
              <div>
                <dt>Duplicate of</dt>
                <dd className="mq-code">{item.duplicateOfAssetId}</dd>
              </div>
            ) : null}
            <div>
              <dt>Added by</dt>
              <dd className="mq-code">{item.uploader.guestId ?? item.uploader.adminId ?? item.uploader.kind}</dd>
            </div>
            <div>
              <dt>Item id</dt>
              <dd className="mq-code">{item.id}</dd>
            </div>
            {item.sha256Short ? (
              <div>
                <dt>Checksum</dt>
                <dd className="mq-code">{item.sha256Short}</dd>
              </div>
            ) : null}
          </dl>
        </details>
      </div>
    </li>
  );
}

interface DangerValues extends Record<string, unknown> {
  reason: string;
  confirmed: boolean;
}

/**
 * Reject or delete the selected items, after saying what that does. Opens even with nothing
 * selected, and then says so, rather than being a dead button with no reason.
 */
function DangerAction({
  action,
  ids,
  names,
  run,
  onDone,
}: {
  action: ModerationAction;
  ids: string[];
  names: string[];
  run: (action: ModerationAction, ids: string[], reason?: string) => Promise<CapabilityResponse<Results>>;
  onDone: (partial: string | null) => Promise<void>;
}) {
  const n = ids.length;
  const what = plural(n, 'item');
  const verb = action === 'delete' ? 'Delete' : 'Reject';
  const shown = names.slice(0, 5);
  return (
    <AdminFlow<DangerValues>
      id={`media:queue:${action}`}
      tone="danger"
      title={n ? `${verb} ${what}` : `${verb} items`}
      trigger={{ label: ACTION_LABEL[action], variant: 'danger', accessibleName: n ? `${verb} the ${what} selected` : `${verb} the selected items` }}
      initial={{ reason: '', confirmed: false }}
      steps={[
        {
          title: n ? `${verb} ${what}?` : 'Nothing is selected',
          fields: ['reason', 'confirmed'],
          render: (ctx) =>
            n ? (
              <>
                <Consequences>
                  <p>
                    {action === 'delete'
                      ? `${n === 1 ? 'It leaves' : 'They leave'} the gallery and the queue. The files are kept for 30 days, and until then “Restore to the queue” under the Deleted filter brings ${n === 1 ? 'it' : 'them'} back. After 30 days ${n === 1 ? 'it is' : 'they are'} removed for good.`
                      : `${n === 1 ? 'It is' : 'They are'} taken out of the queue and never shown in the gallery; anything already published comes down. “Restore to the queue” under the Rejected filter brings ${n === 1 ? 'it' : 'them'} back.`}
                  </p>
                  <ul>
                    {shown.map((s, i) => (
                      <li key={`${s}-${i}`}>{s}</li>
                    ))}
                    {names.length > shown.length ? <li>and {plural(names.length - shown.length, 'more item')}</li> : null}
                  </ul>
                </Consequences>
                <TextField ctx={ctx} name="reason" label="Why" optional hint="Kept in the moderation log with each item." />
                <CheckField ctx={ctx} name="confirmed" label={`Yes, ${verb.toLowerCase()} ${n === 1 ? 'this item' : `these ${n} items`}`} />
              </>
            ) : (
              <p className="flow-copy">Close this, tick the items in the queue, then choose {verb} again.</p>
            ),
          ready: (v) => n > 0 && v.confirmed,
          readyHint: n ? { field: 'confirmed', message: 'Tick the box to confirm.' } : { message: 'Nothing is selected yet.' },
        },
      ]}
      submit={{
        label: n ? `${verb} ${what}` : verb,
        success: `${action === 'delete' ? 'Deleted' : 'Rejected'} ${what}.`,
        run: async (v) => {
          const r = await run(action, ids, v.reason.trim() || undefined);
          if (r.ok && r.data) {
            const failed = r.data.results.some((x) => !x.ok);
            // All done: the sheet's own announcement says so. Some skipped: the queue says which and why.
            await onDone(failed ? summarise(action, r.data) : null);
          }
          return r;
        },
      }}
    />
  );
}
