'use client';

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { photoSrcSet } from '@/themes/shared/photos';

export interface AdventurePhoto {
  alt: string;
  src?: string;
  caption?: string;
}

const REDUCE = '(prefers-reduced-motion: reduce)';
const AUTO_MS = 5000;

const motionStore = {
  subscribe(notify: () => void) {
    const mq = window.matchMedia(REDUCE);
    mq.addEventListener('change', notify);
    return () => mq.removeEventListener('change', notify);
  },
  getSnapshot() {
    return window.matchMedia(REDUCE).matches;
  },
  getServerSnapshot() {
    return true;
  },
};

/**
 * Rotates through an adventure's photos on the detail page. One photo renders as a plain figure.
 * Multiple photos: accessible carousel (~5s auto-advance, pause on hover/focus, keyboard, reduced motion).
 */
export function AdventurePhotoCarousel({ photos, className }: { photos: AdventurePhoto[]; className?: string }) {
  const items = photos.filter((m): m is AdventurePhoto & { src: string } => !!m.src);
  if (items.length === 0) return null;
  if (items.length === 1) {
    const m = items[0]!;
    return (
      <figure className={className}>
        {/* eslint-disable-next-line @next/next/no-img-element -- couple-supplied photo of unknown size */}
        <img className="w-adventure-carousel__img" src={m.src} srcSet={photoSrcSet(m.src)} sizes="(min-width: 48rem) 36rem, 92vw" alt={m.alt} loading="lazy" decoding="async" />
        {m.caption ? <figcaption>{m.caption}</figcaption> : null}
      </figure>
    );
  }
  return <MultiPhotoCarousel items={items} className={className} />;
}

function MultiPhotoCarousel({ items, className }: { items: (AdventurePhoto & { src: string })[]; className?: string }) {
  const reduced = useSyncExternalStore(motionStore.subscribe, motionStore.getSnapshot, motionStore.getServerSnapshot);
  const id = useId();
  const regionId = `${id}-carousel`;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  const count = items.length;
  const autoPlay = !reduced && !paused;

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const go = useCallback(
    (next: number) => {
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  useEffect(() => {
    if (!autoPlay) return;
    let onscreen = true;
    const tick = () => go(indexRef.current + 1);
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(timer);
      if (!onscreen || document.hidden) return;
      timer = setInterval(tick, AUTO_MS);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const root = rootRef.current;
    const observer = root
      ? new IntersectionObserver((entries) => {
          const entry = entries[0];
          if (!entry) return;
          onscreen = entry.isIntersecting;
          if (onscreen && autoPlay) start();
          else stop();
        })
      : null;
    if (root && observer) observer.observe(root);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    start();
    return () => {
      stop();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [go, autoPlay]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(index - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(index + 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      go(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      go(count - 1);
    }
  };

  const pause = () => setPaused(true);
  const resume = () => {
    if (!reduced) setPaused(false);
  };

  return (
    <div
      ref={rootRef}
      className={`w-adventure-carousel${className ? ` ${className}` : ''}`}
      role="region"
      aria-roledescription="carousel"
      aria-label="Photos from this adventure"
      id={regionId}
      onKeyDown={onKeyDown}
      onPointerEnter={pause}
      onPointerLeave={resume}
      onFocusCapture={pause}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume();
      }}
    >
      <div className="w-adventure-carousel__viewport">
        {items.map((m, i) => (
          <figure key={m.src} className="w-adventure-carousel__slide" hidden={i !== index} aria-hidden={i !== index}>
            {/* eslint-disable-next-line @next/next/no-img-element -- couple-supplied photo of unknown size */}
            <img
              className="w-adventure-carousel__img"
              src={m.src}
              srcSet={photoSrcSet(m.src)}
              sizes="(min-width: 48rem) 36rem, 92vw"
              alt={m.alt}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
            />
            {m.caption ? <figcaption>{m.caption}</figcaption> : null}
          </figure>
        ))}
      </div>
      <div className="w-adventure-carousel__controls">
        <button type="button" className="w-adventure-carousel__btn" onClick={() => go(index - 1)} aria-label="Previous photo">
          Previous
        </button>
        <p className="w-adventure-carousel__status" aria-live="polite">
          Photo {index + 1} of {count}
        </p>
        {!reduced ? (
          <button type="button" className="w-adventure-carousel__btn" onClick={() => setPaused((p) => !p)} aria-pressed={paused} aria-label={paused ? 'Resume automatic photo rotation' : 'Pause automatic photo rotation'}>
            {paused ? 'Play' : 'Pause'}
          </button>
        ) : null}
        <button type="button" className="w-adventure-carousel__btn" onClick={() => go(index + 1)} aria-label="Next photo">
          Next
        </button>
      </div>
    </div>
  );
}
