import type { ReactNode } from 'react';
import { GuestCard as BdCard, GuestNotice as BdNotice, GuestSection as BdSection } from './botanical-deco/guest';
import type { ThemeId } from './types';

/**
 * Section, Card and Notice for the GUEST recipes (`/rsvp`, `/guests`, `/transportation`, `/trip`),
 * in the design's own markup rather than one shared recipe wearing a palette.
 *
 * No eyebrow: impeccable's craft floor bans a kicker above a heading with no exception.
 *
 * These are the one part of a theme kit that is **safe to import from a client component**: pure
 * presentation, no `server-only`, no registry, no `next/headers`. `RsvpForm` is `'use client'` and
 * takes the theme as a prop from its server page; everything else resolves it with
 * `getRequestTheme()`. Importing `themes/<id>/kit` instead would drag the whole kit — dialogs,
 * countdown — into the guest bundle, which `tests/e2e/bundle.spec.ts` budgets.
 *
 * `theme` stays in the props: it is the seam a second design would select on.
 */
export interface GuestSectionProps {
  /** Anchor for the section itself; the heading gets `${id}-title`. */
  id: string;
  title: string;
  /** Position in the page's run of sections. */
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

export function GuestSection({ theme: _theme, ...props }: GuestSectionProps & { theme: ThemeId }) {
  return <BdSection {...props} />;
}

export function GuestCard({ theme: _theme, ...props }: GuestCardProps & { theme: ThemeId }) {
  return <BdCard {...props} />;
}

/**
 * The design's own callout. `/rsvp` in the lifecycle states where RSVPs are shut renders a notice
 * and nothing else: in that state the notice IS the page.
 */
export function GuestNotice({ theme: _theme, ...props }: GuestNoticeProps & { theme: ThemeId }) {
  return <BdNotice {...props} />;
}
