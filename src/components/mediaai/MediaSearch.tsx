'use client';

import { useId, useRef, useState } from 'react';
import type { CollectionSummary } from '@/capabilities/media';
import type { SearchHitItem, SearchMediaResult } from '@/capabilities/mediaai';
import { callCapability } from '../media/capabilityClient';
import { MediaEmpty } from '../media/MediaShell';
import './mediaai.css';

const SLOTS = [
  ['', 'Any time'],
  ['before_wedding', 'Before the wedding'],
  ['wedding_morning', 'Wedding day, morning'],
  ['wedding_afternoon', 'Wedding day, afternoon'],
  ['wedding_evening', 'Wedding day, evening'],
  ['wedding_night', 'Wedding day, night'],
  ['after_wedding', 'After the wedding'],
] as const;

const EXAMPLES = ['first dance', 'toasts', 'flowers on the table', 'outside at dusk'];

type State = { status: 'idle' } | { status: 'searching' } | { status: 'done'; result: SearchMediaResult } | { status: 'error'; message: string };

/**
 * Search by meaning over the indexed archive. Every result says which words matched and where its
 * description came from, so a guest can tell a caption they wrote from a machine suggestion. A
 * query that matches nothing says so; nothing is ever invented to fill the grid.
 */
export function MediaSearch({ collections, initialQuery = '' }: { collections: CollectionSummary[]; initialQuery?: string }) {
  const id = useId();
  const [query, setQuery] = useState(initialQuery);
  const [collection, setCollection] = useState('');
  const [kind, setKind] = useState('');
  const [slot, setSlot] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });
  const inFlight = useRef<AbortController | null>(null);

  async function run(next = query) {
    const trimmed = next.trim();
    if (trimmed.length < 2) {
      setState({ status: 'error', message: 'Type at least two characters to search.' });
      return;
    }
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setState({ status: 'searching' });
    const r = await callCapability<SearchMediaResult>(
      'search_media',
      { query: trimmed, ...(collection ? { collection } : {}), ...(kind ? { kind } : {}), ...(slot ? { scheduleSlot: slot } : {}) },
      { signal: controller.signal },
    );
    if (controller.signal.aborted) return;
    setState(r.ok ? { status: 'done', result: r.data } : { status: 'error', message: r.error.message });
  }

  return (
    <div className="mi-search">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="mi-search__row">
          <label className="media-field" htmlFor={`${id}-q`}>
            <span>What are you looking for?</span>
            <input id={`${id}-q`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={200} autoComplete="off" enterKeyHint="search" />
          </label>
          <button type="submit" className="media-button" disabled={state.status === 'searching'}>
            {state.status === 'searching' ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="mi-search__filters">
          <label className="media-field" htmlFor={`${id}-album`}>
            <span>Album</span>
            <select id={`${id}-album`} value={collection} onChange={(e) => setCollection(e.target.value)}>
              <option value="">All albums</option>
              {collections.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="media-field" htmlFor={`${id}-kind`}>
            <span>Photos or video</span>
            <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Both</option>
              <option value="image">Photos</option>
              <option value="video">Video</option>
            </select>
          </label>
          <label className="media-field" htmlFor={`${id}-slot`}>
            <span>When</span>
            <select id={`${id}-slot`} value={slot} onChange={(e) => setSlot(e.target.value)}>
              {SLOTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </form>

      <ul className="mi-examples">
        {EXAMPLES.map((example) => (
          <li key={example}>
            <button
              type="button"
              className="media-button media-button--quiet"
              onClick={() => {
                setQuery(example);
                void run(example);
              }}
            >
              {example}
            </button>
          </li>
        ))}
      </ul>

      <p role="status" aria-live="polite" className="media-lede">
        {state.status === 'searching' ? 'Searching…' : state.status === 'done' ? `${state.result.items.length} ${state.result.items.length === 1 ? 'result' : 'results'} for “${state.result.query}”.` : ''}
      </p>

      {state.status === 'error' ? <p className="mi-notice" data-tone="error">{state.message}</p> : null}
      {state.status === 'done' ? <Results result={state.result} /> : null}
    </div>
  );
}

function Results({ result }: { result: SearchMediaResult }) {
  if (result.items.length === 0) {
    return <MediaEmpty>Nothing in the album matches that yet. Try fewer words, or a different album.</MediaEmpty>;
  }
  return (
    <>
      <ol className="mi-why">
        {result.items.map((item, index) => (
          <li key={item.id}>
            <span className="mi-why__n" aria-hidden="true">
              {index + 1}
            </span>
            <Hit item={item} index={index} />
          </li>
        ))}
      </ol>
      <p className="media-lede">
        Searched with {result.embeddingModel}. Results come from what people wrote and from suggestions a person can edit; nothing here is a guess about who is in a photo.
      </p>
    </>
  );
}

function Hit({ item, index }: { item: SearchHitItem; index: number }) {
  const described = item.altText ?? item.caption ?? null;
  return (
    <div className="mi-suggestion">
      {item.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL; next/image cannot sign it
        <img src={item.thumb.url} alt={described ?? `Result ${index + 1} from ${item.collection.title}`} width={item.thumb.width ?? 400} height={item.thumb.height ?? 300} loading="lazy" decoding="async" />
      ) : null}
      <div>
        <p>{described ?? <em>No description yet.</em>}</p>
        <p className="mi-suggestion__meta">
          {item.collection.title}
          {item.kind === 'video' ? ' · Video' : ''}
          {item.credit ? ` · ${item.credit}` : ''}
          {item.matchedTerms.length ? ` · matched ${item.matchedTerms.join(', ')}` : ''}
        </p>
        <p className="mi-suggestion__meta">{describeSource(item)}</p>
      </div>
    </div>
  );
}

/** Honest provenance for one hit: never "AI-generated caption" when a person wrote it. */
export function describeSource(item: Pick<SearchHitItem, 'sourceMetadata'>): string {
  const { captionSource, humanCaption, captionModel } = item.sourceMetadata;
  if (humanCaption) return 'Described by the person who added it.';
  if (captionSource === 'ai') return `Suggested description from ${captionModel ?? 'a model'}, not yet reviewed.`;
  return 'Found from the album it is in, not from a description.';
}
