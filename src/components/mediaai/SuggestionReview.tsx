'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { MediaAiStatusView } from '@/capabilities/mediaai';
import { AdminFlow } from '@/components/admin/flow/AdminFlow';
import { CheckField, Consequences, GuestPreview, TextField } from '@/components/admin/flow/fields';
import { RecordList, RecordRow } from '@/components/admin/flow/records';
import { callCapability, newIdempotencyKey, type CapabilityResponse } from '@/components/handoff/client';
import '../media/admin-media.css';

type Suggestion = MediaAiStatusView['suggestions'][number];
type Applied = { assetId: string; altText: string | null };

const MIN = 3;
const suggested = (item: Suggestion) => (item.suggestion.suggestedAltText ?? item.suggestion.suggestedCaption ?? '').trim();
const apply = (assetId: string, altText: string) => callCapability<Applied>('admin_apply_media_text', { input: { assetId, altText }, idempotencyKey: newIdempotencyKey() });

/**
 * Machine-written alt text waiting for a person. Nothing reaches a guest until someone here decides.
 *
 * Each suggestion is a row with three ways out:
 *   - "Publish as written": one click, for a suggestion that is already right.
 *   - "Edit and publish": a one-step flow with the text in a box and the photo beside it, so the
 *     published words can be the admin's own.
 *   - "Dismiss": drops the suggestion and leaves the photo without alt text. It cannot be brought
 *     back to this list, so it confirms first (`AdminFlow tone="danger"`).
 *
 * It was an editable textarea and a "Publish this text" button per row: every suggestion was a form,
 * and the only way to be rid of a wrong one was to publish something.
 *
 * A decided row leaves the list at once and the page refreshes behind it (the count in the heading
 * is the server's). The row took its button, and focus, with it, so the list's own status line says
 * what happened and takes focus when nothing else has it.
 */
export function SuggestionReview({ initial }: { initial: Suggestion[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [decided, setDecided] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ text: string; tone?: 'error' } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const items = initial.filter((i) => !decided.has(i.id));

  useEffect(() => {
    if (notice && !notice.tone && (!document.activeElement || document.activeElement === document.body)) noticeRef.current?.focus();
  }, [notice, items.length]);

  const settle = (id: string, text: string) => {
    setDecided((d) => new Set(d).add(id));
    setNotice({ text });
    startTransition(() => router.refresh());
  };

  return (
    <>
      <p ref={noticeRef} tabIndex={-1} className="am-notice" role="status" data-tone={notice?.tone}>
        {notice?.text}
      </p>
      <RecordList label="Suggestions waiting for review" empty={items.length === 0 ? 'No suggestions are waiting. New uploads are described after the next index run.' : null}>
        {items.map((item) => {
          const n = initial.indexOf(item) + 1;
          const text = suggested(item);
          const s = item.suggestion;
          return (
            <RecordRow
              key={item.id}
              data-asset-id={item.id}
              title={`Photo ${n}`}
              status={<span className="con-pill con-pill--neutral">{item.status === 'private' ? 'Awaiting review' : item.status}</span>}
              meta={
                <>
                  {s.venueClass.replaceAll('_', ' ')} · {s.scheduleSlot.replaceAll('_', ' ')}
                  {s.captionModel ? ` · by ${s.captionModel}` : ''}
                  {s.captionConfidence !== null ? ` · confidence ${s.captionConfidence.toFixed(2)}` : ''}
                </>
              }
              actions={
                <>
                  {text.length >= MIN ? <PublishAsWritten item={item} n={n} text={text} onDone={settle} onError={(m) => setNotice({ text: m, tone: 'error' })} /> : null}
                  <EditFlow item={item} n={n} text={text} onDone={settle} />
                  <DismissFlow item={item} n={n} onDone={settle} />
                </>
              }
            >
              <div className="sr-row">
                {item.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
                  <img className="sr-thumb" src={item.thumb.url} alt="" width={item.thumb.width ?? 200} height={item.thumb.height ?? 150} loading="lazy" decoding="async" />
                ) : null}
                <p className="sr-text">{text ? <>Suggested: “{text}”</> : 'No text was suggested for this photo.'}</p>
              </div>
            </RecordRow>
          );
        })}
      </RecordList>
    </>
  );
}

/** One click: the suggestion as it stands becomes the photo's alt text. */
function PublishAsWritten({ item, n, text, onDone, onError }: { item: Suggestion; n: number; text: string; onDone: (id: string, message: string) => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="flow-trigger-quiet"
      aria-disabled={busy || undefined}
      aria-label={`Publish the suggestion for photo ${n} as written`}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        const r = await apply(item.id, text);
        setBusy(false);
        if (!r.ok) return onError(r.error?.message ?? 'That did not publish. Please try again.');
        onDone(item.id, `Photo ${n}: the suggested alt text is published.`);
      }}
    >
      {busy ? 'Publishing…' : 'Publish as written'}
    </button>
  );
}

interface EditValues extends Record<string, unknown> {
  altText: string;
}

function EditFlow({ item, n, text, onDone }: { item: Suggestion; n: number; text: string; onDone: (id: string, message: string) => void }) {
  return (
    <AdminFlow<EditValues>
      id={`ai:alt:${item.id}`}
      title={`Alt text for photo ${n}`}
      trigger={{ label: 'Edit and publish', variant: 'quiet', accessibleName: `Edit and publish the alt text for photo ${n}` }}
      initial={{ altText: text }}
      steps={[
        {
          title: 'Put it in your own words',
          lede: 'Alt text is what someone who cannot see the photo hears instead. Say what is in it, plainly.',
          fields: ['altText'],
          render: (ctx) => (
            <>
              <TextField ctx={ctx} name="altText" label="Alt text" multiline rows={3} hint={`${ctx.values.altText.trim().length} of 400 characters.`} />
              <GuestPreview label="What a screen reader says for this photo">
                <div className="sr-row">
                  {item.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
                    <img className="sr-thumb" src={item.thumb.url} alt="" width={item.thumb.width ?? 200} height={item.thumb.height ?? 150} loading="lazy" decoding="async" />
                  ) : null}
                  <p className="sr-text">{ctx.values.altText.trim() || '(nothing yet)'}</p>
                </div>
              </GuestPreview>
            </>
          ),
          ready: (v) => v.altText.trim().length >= MIN && v.altText.length <= 400,
          readyHint: { field: 'altText', message: `Write at least ${MIN} characters, and no more than 400.` },
        },
      ]}
      submit={{
        label: 'Publish this text',
        success: 'Alt text published.',
        run: async (v): Promise<CapabilityResponse> => {
          const r = await apply(item.id, v.altText.trim());
          if (r.ok) onDone(item.id, `Photo ${n}: your alt text is published.`);
          return r;
        },
      }}
    />
  );
}

interface DismissValues extends Record<string, unknown> {
  confirmed: boolean;
}

function DismissFlow({ item, n, onDone }: { item: Suggestion; n: number; onDone: (id: string, message: string) => void }) {
  return (
    <AdminFlow<DismissValues>
      id={`ai:dismiss:${item.id}`}
      tone="danger"
      title={`Dismiss the suggestion for photo ${n}`}
      trigger={{ label: 'Dismiss', variant: 'danger', accessibleName: `Dismiss the suggestion for photo ${n}` }}
      initial={{ confirmed: false }}
      steps={[
        {
          title: `Dismiss the suggestion for photo ${n}?`,
          fields: ['confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>The suggested text is dropped and the photo keeps no alt text. It is marked as reviewed, so it does not come back to this list.</p>
              </Consequences>
              <CheckField ctx={ctx} name="confirmed" label="Yes, dismiss this suggestion" />
            </>
          ),
          ready: (v) => v.confirmed,
          readyHint: { field: 'confirmed', message: 'Tick the box to confirm.' },
        },
      ]}
      submit={{
        label: 'Dismiss the suggestion',
        success: 'Suggestion dismissed.',
        run: async (): Promise<CapabilityResponse> => {
          // An empty string clears the field and marks the suggestion reviewed (admin_apply_media_text).
          const r = await apply(item.id, '');
          if (r.ok) onDone(item.id, `Photo ${n}: the suggestion is dismissed.`);
          return r;
        },
      }}
    />
  );
}
