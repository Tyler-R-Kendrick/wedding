'use client';

import { useEffect } from 'react';

/**
 * Lets a page (Home, Our Venue) unfold as a guest scrolls. Every `[data-reveal]` element that
 * starts wholly below the first screen is marked `pending` (held just out of place) and plays its
 * entrance once, when it scrolls into view; anything with so much as its top edge on screen at load
 * is left exactly as the server drew it, so nothing a guest can already see ever disappears.
 *
 * Time-based on purpose, not scroll-linked: a scroll-linked fade leaves whatever is half in view
 * sitting half transparent for as long as the guest stops there. Keyboard focus reveals its section
 * at once, so a focused link is never invisible while the page scrolls to it. Nothing is hidden
 * before this runs, so without scripting, with reduced motion, or in print the page is all there.
 */
export function Reveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const later = [...document.querySelectorAll<HTMLElement>('[data-reveal]')].filter((el) => el.getBoundingClientRect().top >= window.innerHeight);
    if (!later.length) return;
    // `in` plays the entrance; `shown` is the same element with no entrance at all. Focus takes
    // `shown`, even mid-entrance: an entrance starts from transparent and a list's later entries wait
    // a beat before theirs, so a link focused by Tab would otherwise sit invisible under the ring.
    const show = (el: Element, state: 'in' | 'shown') => {
      if (!(el instanceof HTMLElement) || !el.dataset.revealState || el.dataset.revealState === 'shown') return;
      if (state === 'in' && el.dataset.revealState !== 'pending') return;
      el.dataset.revealState = state;
      io.unobserve(el);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) show(e.target, 'in');
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    const onFocus = (e: FocusEvent) => {
      if (!(e.target instanceof Element)) return;
      const el = e.target.closest<HTMLElement>('[data-reveal-state="pending"], [data-reveal-state="in"]');
      if (!el) return;
      // Mid-entrance, only keyboard focus cuts the entrance short. A mouse focuses a link on
      // mousedown, and snapping the card into place then moved it out from under the pointer before
      // mouseup, so the click never happened.
      if (el.dataset.revealState === 'in' && !e.target.matches(':focus-visible')) return;
      show(el, 'shown');
    };
    for (const el of later) {
      el.dataset.revealState = 'pending';
      io.observe(el);
    }
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('focusin', onFocus);
      io.disconnect();
      for (const el of later) delete el.dataset.revealState;
    };
  }, []);
  return null;
}
