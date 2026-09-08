import type { ReactNode } from 'react';
import { GuestCard as GhCard, GuestNotice as GhNotice, GuestSection as GhSection } from './gilded-hour/guest';
import { GuestCard as CvCard, GuestNotice as CvNotice, GuestSection as CvSection } from './conservatory/guest';
import type { ThemeId } from './types';

/**
 * Section and Card for the GUEST recipes, per design.
 *
 * Level 16 moved `/rsvp`, `/your-weekend`, `/transportation` and `/trip` inside the active design's
 * `Shell`. That was half the job: the shell changed and the page bodies did not. An independent
 * review measured **zero** themed elements inside `<main>` on all four routes and identical DOM
 * element counts under both designs — one shared recipe wearing two palettes. `.sec` gave every
 * section a 1px full-width rule and `text-align: start`, which is Gilded Hour's opposite (its
 * DESIGN.md asks for an eyebrow, a chevron divider and a heading on the page axis) and is banned
 * outright by Conservatory's ("separated by washes … and by fern dividers … not by full-width rules
 * and not by identical whitespace").
 *
 * So the markup itself differs, not only the values in it. Each kit owns its own pair.
 *
 * Neither kit takes an eyebrow. The first version of this seam had an `eyebrow?: string` and 15
 * call sites passed one ("For you", "Please answer", "Where you sit" …); impeccable's craft floor
 * bans a kicker above a heading with no exception, and `impeccable detect <url>` caught the one
 * instance reachable without a session. Each kit's own file records the reasoning.
 *
 * These are the one part of a theme kit that is **safe to import from a client component**: pure
 * presentation, no `server-only`, no registry, no `next/headers`. `RsvpForm` is `'use client'` and
 * takes the theme as a prop from its server page; everything else resolves it with
 * `getRequestTheme()`. Importing `themes/<id>/kit` instead would drag the whole kit — dialogs,
 * switcher, countdown — into the guest bundle, which `tests/e2e/bundle.spec.ts` budgets.
 */
export interface GuestSectionProps {
  /** Anchor for the section itself; the heading gets `${id}-title`. */
  id: string;
  title: string;
  /**
   * Position in the page's run of sections. Conservatory alternates its ground and its top space on
   * it, because its DESIGN.md forbids separating sections "by identical whitespace"; Gilded Hour
   * uses it to drop the chevron above the first section, which sits under the page title already.
   */
  index?: number;
  children: ReactNode;
}

export interface GuestNoticeProps {
  tone?: 'info' | 'urgent' | 'success';
  title?: ReactNode;
  children: ReactNode;
}

export interface GuestCardProps {
  title?: string;
  /** Heading level inside the card. Defaults to 3, under the section's `<h2>`. */
  level?: 2 | 3 | 4;
  titleId?: string;
  children: ReactNode;
}

export function GuestSection({ theme, ...props }: GuestSectionProps & { theme: ThemeId }) {
  return theme === 'conservatory' ? <CvSection {...props} /> : <GhSection {...props} />;
}

export function GuestCard({ theme, ...props }: GuestCardProps & { theme: ThemeId }) {
  return theme === 'conservatory' ? <CvCard {...props} /> : <GhCard {...props} />;
}

/**
 * The design's own callout. `/rsvp` in the lifecycle states where RSVPs are shut renders a notice
 * and nothing else — which is why that route still measured zero themed elements after the sections
 * were themed: in that state the notice IS the page.
 */
export function GuestNotice({ theme, ...props }: GuestNoticeProps & { theme: ThemeId }) {
  return theme === 'conservatory' ? <CvNotice {...props} /> : <GhNotice {...props} />;
}
