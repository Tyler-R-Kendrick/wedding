import type { LifecycleState } from '@/contracts/lifecycle';
import { throughSignIn } from '@/domain/lifecycle/account';
import { currentGuestAction } from '@/domain/lifecycle/guest-actions';
import type { ActionLink, Copy, HomeContent, HomeSection, PublicSiteFacts } from '@/themes/types';

/**
 * Home, for a reader who is not signed in (design-doc §3 "Home's job", ADR-0012 §4). A signed-in
 * guest never sees this page: `/` sends them to their dashboard.
 *
 * **Nothing here says when or where the wedding is.** The date, the venue and the city belong to the
 * invited guests and live behind sign-in, so this model is built from `PublicSiteFacts` — the two
 * names — and cannot name them. What it does carry is the one thing a guest should do at this point
 * in the timeline, as the hero's primary button: the same action their dashboard opens with
 * (`currentGuestAction`), reached through the sign-in door, so signed out it is "sign in and go
 * there" and signed in it is simply "go there".
 *
 * Theme-agnostic: every design's Home recipe renders this model with its own structure.
 */
const ROUTES = {
  story: '/our-story',
  adventures: '/our-adventures',
  portal: throughSignIn('/guests'),
} as const;

function sections(state: LifecycleState): Record<string, HomeSection> {
  const action = currentGuestAction(state);
  return {
    guests: {
      id: 'guests',
      label: 'Invited guests',
      act: 'hospitality',
      title: 'Everything for the weekend is inside',
      body: ['Sign in with the email or mobile number we have for you. No password: we send a six-digit code. Inside is the date, the place, and what to do next.'],
      link: { label: action.label, href: throughSignIn(action.href), variant: 'primary' },
    },
    memory: {
      id: 'our-story',
      label: 'Memory',
      act: 'memory',
      title: 'How we met',
      body: ['We met at a friend’s wedding, where an evening of talking and playing games led to Tyler asking Sara out. A new chapter began.'],
      link: { label: 'Our Story', href: ROUTES.story },
    },
    adventure: {
      id: 'adventures',
      label: 'Adventure',
      act: 'adventure',
      title: 'Our adventures',
      body: ['The places we have been together, each with what Sara remembers and what Tyler remembers.'],
      link: { label: 'Our Adventures', href: ROUTES.adventures },
    },
    thanks: {
      id: 'thank-you',
      label: 'Thanks',
      act: 'thanks',
      title: 'Thank you',
      body: ['For travelling, for dancing, for being there.'],
    },
  };
}

interface HeroCopy {
  eyebrow: string;
  lede: Copy;
}

const WELCOME: Copy = ['Welcome to our wedding website. If you are one of our guests, sign in to reserve your room and start planning your trip.'];

function hero(state: LifecycleState): HeroCopy {
  switch (state) {
    case 'TEASER':
      return { eyebrow: 'We are getting married', lede: WELCOME };
    case 'SAVE_THE_DATE':
      return { eyebrow: 'Save the date', lede: ['Our room block is open. Sign in to reserve your room and start planning your trip.'] };
    case 'INVITATIONS_OPEN':
      return { eyebrow: 'Invitations are out', lede: ['Your invitation is waiting. Sign in to open it.'] };
    case 'RSVP_OPEN':
      return { eyebrow: 'RSVP is open', lede: ['Tell us who is coming. It takes about two minutes, and you can change it later.'] };
    case 'RSVP_CLOSED':
      return { eyebrow: 'See you soon', lede: ['RSVPs are in and we cannot wait. Sign in for everything you need for the weekend.'] };
    case 'WEDDING_WEEK':
      // Nothing here may say how close the day is: this is the page a stranger sees.
      return { eyebrow: 'See you soon', lede: ['Sign in for your schedule and everything you need.'] };
    case 'WEDDING_DAY':
      return { eyebrow: 'See you soon', lede: ['Sign in for your schedule and everything you need.'] };
    case 'POST_WEDDING':
      return { eyebrow: 'Thank you', lede: ['For travelling, for dancing, for being there. Sign in to add your photos; ours will follow.'] };
    case 'ARCHIVE':
      return { eyebrow: 'Thank you', lede: ['The weekend, preserved for the people who shared it.'] };
  }
}

const SECTION_ORDER: Record<LifecycleState, string[]> = {
  TEASER: ['memory', 'adventure', 'guests'],
  SAVE_THE_DATE: ['guests', 'memory', 'adventure'],
  INVITATIONS_OPEN: ['guests', 'memory', 'adventure'],
  RSVP_OPEN: ['guests', 'memory', 'adventure'],
  RSVP_CLOSED: ['guests', 'memory', 'adventure'],
  WEDDING_WEEK: ['guests', 'memory', 'adventure'],
  WEDDING_DAY: ['guests', 'memory', 'adventure'],
  POST_WEDDING: ['thanks', 'guests', 'memory', 'adventure'],
  ARCHIVE: ['thanks', 'memory', 'adventure', 'guests'],
};

export function homeContent(site: PublicSiteFacts, state: LifecycleState): HomeContent {
  const all = sections(state);
  const h = hero(state);
  const action = currentGuestAction(state);
  const primary: ActionLink = { label: action.label, href: throughSignIn(action.href), variant: state === 'RSVP_OPEN' ? 'accent' : 'primary' };
  return {
    title: site.coupleDisplayName,
    eyebrow: h.eyebrow,
    lede: h.lede,
    primary,
    secondary: { label: 'Our Story', href: ROUTES.story, variant: 'ghost' },
    sections: SECTION_ORDER[state].map((key) => all[key]!),
  };
}

/** The five motifs (brief §4) as section eyebrows; "Today" and "Gratitude" for the operate/remember acts. */
export const ACT_LABEL: Record<import('@/themes/types').HomeAct, string> = {
  adventure: 'Adventure',
  place: 'Place',
  memory: 'Memory',
  hospitality: 'Hospitality',
  future: 'Future',
  now: 'Today',
  thanks: 'Gratitude',
};
