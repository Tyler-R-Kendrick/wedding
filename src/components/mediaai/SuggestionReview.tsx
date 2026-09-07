'use client';

import { useState } from 'react';
import type { MediaAiStatusView } from '@/capabilities/mediaai';
import { newId } from '@/contracts/ids';
import { callCapability } from '../media/capabilityClient';
import { MediaEmpty } from '../media/MediaShell';
import './mediaai.css';

type Suggestion = MediaAiStatusView['suggestions'][number];

/**
 * The review queue: a machine suggestion next to an editable field. Nothing here is published
 * until a person presses Publish, and the field is editable precisely so the published text is
 * theirs rather than the model's.
 */
export function SuggestionReview({ initial }: { initial: Suggestion[] }) {
  const [items, setItems] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);

  if (items.length === 0) return <MediaEmpty>No suggestions are waiting. New uploads are described after the next index run.</MediaEmpty>;

  return (
    <div>
      {notice ? <p className="mi-notice" role="status">{notice}</p> : null}
      {items.map((item) => (
        <Row
          key={item.id}
          item={item}
          onApplied={(id) => {
            setItems((prev) => prev.filter((x) => x.id !== id));
            setNotice('Published. It is the text you approved, not the suggestion.');
          }}
          onError={setNotice}
        />
      ))}
    </div>
  );
}

function Row({ item, onApplied, onError }: { item: Suggestion; onApplied: (id: string) => void; onError: (m: string) => void }) {
  const [text, setText] = useState(item.suggestion.suggestedAltText ?? item.suggestion.suggestedCaption ?? '');
  const [busy, setBusy] = useState(false);

  async function apply() {
    setBusy(true);
    const r = await callCapability('admin_apply_media_text', { assetId: item.id, altText: text }, { mutation: true, idempotencyKey: newId() });
    setBusy(false);
    if (!r.ok) return onError(r.error.message);
    onApplied(item.id);
  }

  return (
    <div className="mi-suggestion">
      {item.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
        <img src={item.thumb.url} alt="" width={item.thumb.width ?? 200} height={item.thumb.height ?? 150} loading="lazy" decoding="async" />
      ) : null}
      <div>
        <p className="mi-suggestion__meta">
          {item.status} · {item.suggestion.venueClass} · {item.suggestion.scheduleSlot.replaceAll('_', ' ')}
          {item.suggestion.captionModel ? ` · ${item.suggestion.captionModel}` : ''}
          {item.suggestion.captionConfidence !== null ? ` · confidence ${item.suggestion.captionConfidence.toFixed(2)}` : ''}
        </p>
        <label className="media-field">
          <span>Alt text to publish (edit before you publish it)</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={400} />
        </label>
        <div className="media-actions">
          <button type="button" className="media-button" onClick={() => void apply()} disabled={busy || text.trim().length < 3}>
            {busy ? 'Publishing…' : 'Publish this text'}
          </button>
        </div>
      </div>
    </div>
  );
}
