'use client';

import { useEffect } from 'react';

/**
 * Lets the home page unfold as a guest scrolls. Every `[data-reveal]` element that starts below the
 * first screen is marked `pending` (held just out of place) and plays its entrance once, when it
 * scrolls into view; anything already on screen at load is left exactly as the server drew it.
 *
 * Time-based on purpose, not scroll-linked: a scroll-linked fade leaves whatever is half in view
 * sitting half transparent for as long as the guest stops there. Nothing is hidden before this runs,
 * so without scripting, with reduced motion, or in print the page is simply all there.
 */
export function Reveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const fold = window.innerHeight * 0.92;
    const later = [...document.querySelectorAll<HTMLElement>('[data-reveal]')].filter((el) => el.getBoundingClientRect().top > fold);
    if (!later.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.revealState = 'in';
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    for (const el of later) {
      el.dataset.revealState = 'pending';
      io.observe(el);
    }
    return () => {
      io.disconnect();
      for (const el of later) delete el.dataset.revealState;
    };
  }, []);
  return null;
}
