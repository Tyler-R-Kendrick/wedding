'use client';

import { useLayoutEffect, useRef } from 'react';

/**
 * Decides from the words' real widths how much of a masthead fits, instead of guessing from how
 * many pages the state has.
 *
 * The mastheads used to pick a breakpoint per page COUNT ("more than six pages: Menu below
 * 1320px"). That held until the sitemap's labels arrived ("Travel & Stay", "Share an Adventure",
 * "Your account"): the same count became a wider row, the centred Botanical–Deco list spilled out
 * of its column both ways, and "HOME" was painted over the S|T monogram at every desktop width.
 * The Gilded Hour frieze wrapped its left wing onto a second, ragged line the same way. A count
 * cannot know a label's width; the rendered row can.
 *
 * Mount it as a child of the masthead container. It never renders anything visible (a `hidden`
 * span is not a grid or flex item) and speaks to the kit's CSS only through data attributes:
 *
 * - on the container, `data-fit`: `measure` for the one synchronous layout it reads, then `all`
 *   (everything fits) or `some` (the Menu sheet is needed). Absent until hydration, and whenever
 *   the row is not displayed at all (a phone, where the sheet already holds every page), so the
 *   kit's no-script rules are what apply there.
 * - `priority` mode (a row of pages in order): the list is `[data-fit-list]`; each `<li>` past the
 *   last one that fits beside the Menu button gets `data-fit-hidden`. The sheet lists every page,
 *   so nothing becomes unreachable.
 * - `whole` mode (a composition that only works complete, like the frieze mirrored around its
 *   plaque): every `[data-fit-row]` must hold its links on one line, or the whole row gives way to
 *   the Menu.
 *
 * It re-measures when the container resizes, when the web font lands, and when a label changes
 * (the account slot reads "Sign in" on the server and "Your account" once the session is known).
 */
export function NavFit({ mode }: { mode: 'priority' | 'whole' }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const box = ref.current?.parentElement;
    if (!box) return;
    let frame = 0;

    const fit = () => {
      frame = 0;
      box.dataset.fit = 'measure';
      const rows = mode === 'priority' ? [...box.querySelectorAll<HTMLElement>('[data-fit-list]')] : [...box.querySelectorAll<HTMLElement>('[data-fit-row]')];
      if (!rows.length || rows.every((row) => getComputedStyle(row).display === 'none')) {
        delete box.dataset.fit;
        return;
      }
      if (mode === 'whole') {
        // Summed, not `scrollWidth`: a wing aligned to its end overflows toward its start, which
        // scrollWidth does not count.
        const overflows = rows.some((row) => need(row).total > row.clientWidth + 1);
        box.dataset.fit = overflows ? 'some' : 'all';
        return;
      }
      const list = rows[0]!;
      const { items, gap, widths, total } = need(list);
      // In `measure` the Menu button is showing, so the list's own width is the room it has
      // beside it; the Menu's width (and the gap before it) is what dropping the button returns.
      const room = list.clientWidth;
      const menu = box.querySelector<HTMLElement>('[data-fit-menu]');
      const menuRoom = menu ? menu.getBoundingClientRect().width + (parseFloat(getComputedStyle(menu.parentElement ?? box).columnGap) || 0) : 0;
      let shown = widths.length;
      if (total > room + menuRoom) {
        shown = 0;
        let used = 0;
        for (const w of widths) {
          const next = used + (shown ? gap : 0) + w;
          if (next > room) break;
          used = next;
          shown++;
        }
      }
      items.forEach((li, i) => li.toggleAttribute('data-fit-hidden', i >= shown));
      box.dataset.fit = shown < items.length ? 'some' : 'all';
    };

    /** What a row asks for on one line: its items' own widths (the kit's `measure` rules stop them shrinking) and the gaps between. */
    const need = (row: HTMLElement) => {
      const items = [...row.children] as HTMLElement[];
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const widths = items.map((li) => li.getBoundingClientRect().width);
      return { items, gap, widths, total: widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1) };
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };

    fit();
    // A browser without the observers (a test DOM) keeps the first measure; every browser the
    // site supports has both.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resize?.observe(box);
    // A label that changes after hydration (the account slot) changes the row without resizing the box.
    const labels = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
    labels?.observe(box, { subtree: true, childList: true, characterData: true });
    document.fonts?.ready.then(schedule, () => {});

    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize?.disconnect();
      labels?.disconnect();
    };
  }, [mode]);

  return <span ref={ref} hidden data-nav-fit={mode} />;
}
