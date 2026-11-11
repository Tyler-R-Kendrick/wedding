import { describe, expect, it } from 'vitest';
import { LIFECYCLE_STATES, type LifecycleState } from '@/contracts/lifecycle';
import { SEED_SITE } from '@/db/seed/seed';
import { destinationOf } from '@/domain/lifecycle/account';
import { toSiteFacts } from '@/domain/lifecycle/facts';
import { currentGuestAction } from '@/domain/lifecycle/guest-actions';
import { homeContent } from '@/themes/shared/home-content';
import type { ActionLink, HomeContent, PublicSiteFacts } from '@/themes/types';

/** Everything the site knows, the date and the venue included. */
const full = toSiteFacts({ ...SEED_SITE });
/** What Home is built from: the two names. */
const site: PublicSiteFacts = { coupleDisplayName: full.coupleDisplayName, partner1: full.partner1, partner2: full.partner2 };

/**
 * When and where the wedding is, in every form the site prints it. Home is the one page a stranger
 * with the link reads, so none of these may appear in its model, in any state.
 */
const WEDDING_DETAILS = [
  full.date.iso,
  full.date.long,
  full.date.motif,
  full.date.weekday,
  'July',
  '2027',
  '07 · 17',
  full.venue.name,
  'Athletic Association',
  full.venue.address,
  'Michigan Ave',
  '60603',
  full.venue.city,
  full.venue.url!,
  'chicagoathletichotel',
  full.venue.mapsUrl,
  'google.com/maps',
];

/** The hero's primary button by state: the one thing a guest should do now, through the sign-in door. */
const PRIMARY: Record<LifecycleState, { label: string; to: string }> = {
  TEASER: { label: 'Book your hotel room', to: '/guests/travel' },
  SAVE_THE_DATE: { label: 'Book your hotel room', to: '/guests/travel' },
  INVITATIONS_OPEN: { label: 'Open your invitation', to: '/guests' },
  RSVP_OPEN: { label: 'RSVP', to: '/rsvp' },
  RSVP_CLOSED: { label: 'Plan your weekend', to: '/guests' },
  WEDDING_WEEK: { label: 'Your weekend', to: '/guests' },
  // Never "today": this is the page a stranger reads.
  WEDDING_DAY: { label: 'Your weekend', to: '/guests' },
  POST_WEDDING: { label: 'Add your photos', to: '/photos' },
  ARCHIVE: { label: 'Photos and video', to: '/photos' },
};

const SECTIONS: Record<LifecycleState, string[]> = {
  TEASER: ['our-story', 'adventures', 'guests'],
  SAVE_THE_DATE: ['guests', 'our-story', 'adventures'],
  INVITATIONS_OPEN: ['guests', 'our-story', 'adventures'],
  RSVP_OPEN: ['guests', 'our-story', 'adventures'],
  RSVP_CLOSED: ['guests', 'our-story', 'adventures'],
  WEDDING_WEEK: ['guests', 'our-story', 'adventures'],
  WEDDING_DAY: ['guests', 'our-story', 'adventures'],
  POST_WEDDING: ['thank-you', 'guests', 'our-story', 'adventures'],
  ARCHIVE: ['thank-you', 'our-story', 'adventures', 'guests'],
};

const links = (c: HomeContent): ActionLink[] => [c.primary, ...(c.secondary ? [c.secondary] : []), ...c.sections.flatMap((s) => (s.link ? [s.link] : []))];

describe('home content by lifecycle state', () => {
  it.each(LIFECYCLE_STATES)('%s: the couple’s names, one primary action through sign-in, Our Story beside it', (state) => {
    const c = homeContent(site, state);
    // Always the names. "Today" on the wedding day would say when it is.
    expect(c.title).toBe('Sara + Tyler');
    expect(c.primary).toEqual({ label: PRIMARY[state].label, href: `/sign-in?next=${encodeURIComponent(PRIMARY[state].to)}`, variant: state === 'RSVP_OPEN' ? 'accent' : 'primary' });
    // The same action the dashboard opens with, so Home and /guests move together.
    expect(destinationOf(c.primary.href)).toBe(currentGuestAction(state).href);
    expect(c.primary.label).toBe(currentGuestAction(state).label);
    expect(c.secondary).toEqual({ label: 'Our Story', href: '/our-story', variant: 'ghost' });
    // How a guest gets in is said once, in the invited-guests section, not under the hero as well.
    expect(c.note).toBeUndefined();
    expect(c.sections.map((s) => s.id)).toEqual(SECTIONS[state]);
    expect(new Set(c.sections.map((s) => s.id)).size).toBe(c.sections.length);
  });

  it.each(LIFECYCLE_STATES)('%s: says nothing about when or where the wedding is', (state) => {
    // Handed everything the site knows, the model still carries none of it.
    for (const facts of [site, full]) {
      const c = homeContent(facts, state);
      const text = JSON.stringify(c);
      for (const detail of WEDDING_DETAILS) expect(text, `${state}: "${detail}"`).not.toContain(detail);
      // No countdown, no RSVP deadline, and no section that could hold facts, a schedule or a map.
      expect(Object.keys(c).sort()).toEqual(['eyebrow', 'lede', 'primary', 'secondary', 'sections', 'title']);
      for (const s of c.sections) {
        expect(['guests', 'our-story', 'adventures', 'thank-you'], `${state}: ${s.id}`).toContain(s.id);
        for (const key of Object.keys(s)) expect(['id', 'act', 'label', 'title', 'body', 'link'], `${state}: ${s.id}.${key}`).toContain(key);
      }
    }
  });

  it.each(LIFECYCLE_STATES)('%s: every link is a public page or the sign-in door, never a guest page directly', (state) => {
    for (const link of links(homeContent(site, state))) {
      if (link.href.startsWith('/sign-in?next=')) continue;
      expect(['/our-story', '/our-adventures'], `${state}: ${link.label}`).toContain(link.href);
    }
    // The invited-guests section repeats the hero's action, by the same door.
    const guests = homeContent(site, state).sections.find((s) => s.id === 'guests');
    expect(guests?.link).toEqual({ label: PRIMARY[state].label, href: `/sign-in?next=${encodeURIComponent(PRIMARY[state].to)}`, variant: 'primary' });
  });

  it('never states an unsettled fact as prose', () => {
    const all = JSON.stringify(LIFECYCLE_STATES.map((s) => homeContent(full, s)));
    for (const invented of ['White City', 'Cindy', 'shuttle', '4:00', 'ORD', 'MDW', 'cocktail attire', 'black tie']) expect(all).not.toContain(invented);
  });

  it('follows the timeline: the door comes last before there is anything to do, first once there is, and thanks lead afterwards', () => {
    expect(homeContent(site, 'TEASER').sections.map((s) => s.act)).toEqual(['memory', 'adventure', 'hospitality']);
    for (const state of ['SAVE_THE_DATE', 'INVITATIONS_OPEN', 'RSVP_OPEN', 'RSVP_CLOSED', 'WEDDING_WEEK', 'WEDDING_DAY'] as const) expect(homeContent(site, state).sections[0]?.id, state).toBe('guests');
    expect(homeContent(site, 'POST_WEDDING').sections.map((s) => s.act)).toEqual(['thanks', 'hospitality', 'memory', 'adventure']);
    expect(homeContent(site, 'ARCHIVE').sections[0]?.id).toBe('thank-you');
    // Only the RSVP is drawn in the accent: it is the one reply we are waiting on.
    for (const state of LIFECYCLE_STATES) expect(homeContent(site, state).primary.variant, state).toBe(state === 'RSVP_OPEN' ? 'accent' : 'primary');
  });
});
