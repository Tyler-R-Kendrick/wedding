'use client';

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

const AUTO_MS = 5000;
const REDUCE = '(prefers-reduced-motion: reduce)';

const onMotionChange = (notify: () => void) => {
  const mq = window.matchMedia(REDUCE);
  mq.addEventListener('change', notify);
  return () => mq.removeEventListener('change', notify);
};

export interface StoryMediaCarouselProps {
  label: string;
  slides: ReactNode[];
  className?: string;
}

/**
 * Accessible crossfade carousel for merged Our Story chapters: auto-advances about every five
 * seconds, pauses on hover and focus, respects prefers-reduced-motion, keeps each slide's alt text.
 */
export function StoryMediaCarousel({ label, slides, className }: StoryMediaCarouselProps) {
  const reduced = useSyncExternalStore(onMotionChange, () => window.matchMedia(REDUCE).matches, () => false);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const root = useRef<HTMLElement>(null);
  const id = useId();
  const count = slides.length;
  const active = count ? index % count : 0;

  const go = useCallback((i: number) => setIndex(((i % count) + count) % count), [count]);

  useEffect(() => {
    if (count <= 1 || reduced || paused) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % count), AUTO_MS);
    return () => window.clearInterval(t);
  }, [count, reduced, paused]);

  if (count === 0) return null;
  if (count === 1) return <>{slides[0]}</>;

  const hold = () => setPaused(true);
  const release = () => setPaused(false);

  return (
    <section
      ref={root}
      className={`story-carousel${className ? ` ${className}` : ''}`}
      aria-roledescription="carousel"
      aria-label={label}
      data-reduced={reduced ? '' : undefined}
      onMouseEnter={hold}
      onMouseLeave={release}
      onFocus={hold}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) release();
      }}
    >
      <div className="story-carousel__viewport">
        <ol
          className="story-carousel__track"
          aria-live="off"
          style={{ transform: `translateX(-${active * 100}%)`, ...(reduced ? { '--story-carousel-duration': '0ms' } : {}) }}
        >
          {slides.map((slide, i) => (
            <li key={i} id={`${id}-slide-${i + 1}`} className="story-carousel__slide" {...(i !== active ? { inert: true } : {})} aria-labelledby={`${id}-label-${i + 1}`}>
              <span id={`${id}-label-${i + 1}`} className="sr-only">
                {label}: image {i + 1} of {count}
              </span>
              {slide}
            </li>
          ))}
        </ol>
      </div>
      <div className="story-carousel__controls">
        <ul className="story-carousel__dots" aria-label={`${label} slides`}>
          {slides.map((_, i) => (
            <li key={i}>
              <button type="button" className="story-carousel__dot" aria-label={`Show image ${i + 1} of ${count}`} aria-current={i === active ? 'true' : undefined} onClick={() => go(i)} />
            </li>
          ))}
        </ul>
        {!reduced ? (
          <button type="button" className="story-carousel__pause" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
            {paused ? 'Resume slideshow' : 'Pause slideshow'}
          </button>
        ) : null}
      </div>
    </section>
  );
}
