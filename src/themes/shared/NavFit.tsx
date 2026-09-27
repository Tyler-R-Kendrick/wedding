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
 * - An optional `[data-fit-extra]` (the Botanical–Deco motto) is ornament: it is kept only when every
 *   page fits beside it, and the container says which with `data-fit-extra="show" | "hide"`. The
 *   kit's CSS shows it during `measure-extra` so its width can be read, and hides it during `measure`.
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
      const extra = box.querySelector<HTMLElement>('[data-fit-extra]');
      // The room the list would have with the ornament showing and no Menu button, read in exactly
      // that layout (the kit shows the ornament during `measure-extra` only where it may appear at
      // all, and hides the Menu): no guessing at gaps or tracks, and no room counted twice.
      let roomWithExtra = -Infinity;
      if (extra) {
        // The last answer is withdrawn first, so only the measuring rules apply while measuring.
        delete box.dataset.fitExtra;
        box.dataset.fit = 'measure-extra';
        const list = box.querySelector<HTMLElement>('[data-fit-list]');
        if (list && extra.getBoundingClientRect().width > 0) roomWithExtra = inner(list);
      }
      box.dataset.fit = 'measure';
      const rows = mode === 'priority' ? [...box.querySelectorAll<HTMLElement>('[data-fit-list]')] : [...box.querySelectorAll<HTMLElement>('[data-fit-row]')];
      if (!rows.length || rows.every((row) => getComputedStyle(row).display === 'none')) {
        delete box.dataset.fit;
        return;
      }
      if (mode === 'whole') {
        // Summed, not `scrollWidth`: a wing aligned to its end overflows toward its start, which
        // scrollWidth does not count.
        const overflows = rows.some((row) => need(row).total > inner(row) + 1);
        box.dataset.fit = overflows ? 'some' : 'all';
        return;
      }
      const list = rows[0]!;
      const { items, gap, widths, total } = need(list);
      // In `measure` the Menu button is showing, so the list's own content box is the room it has
      // beside it; the Menu's width (and the gap before it) is what dropping the button returns.
      // The padding is not room: it is where the list's focus rings sit inside its clip.
      const room = inner(list);
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
      // `roomWithExtra` was read with the Menu button hidden (the kit hides it in `measure-extra`):
      // the motto only ever shows beside a complete row, so that is the room it has to share.
      if (extra) box.dataset.fitExtra = shown === items.length && total <= roomWithExtra ? 'show' : 'hide';
    };

    /** A row's content box: its width less its own padding. */
    const inner = (row: HTMLElement) => {
      const cs = getComputedStyle(row);
      return row.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
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
