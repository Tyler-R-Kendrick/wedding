import type { LifecycleState } from '@/contracts/lifecycle';

/**
 * What a guest should do now, by where we are in the timeline.
 *
 * One table, read twice: Home's hero button names the state's action for a reader who has not
 * signed in yet, and the dashboard at `/guests` opens with the same thing for one who has. Change
 * the order here and both move together, which is the point — when the save-the-dates go out the
 * room block leads; when the RSVP opens it takes the lead and the room block steps down; nothing a
 * guest cannot use yet (a table before seating is published, photos before the day) is listed at all.
 *
 * Pure: no clock, no database. The page supplies the facts (`DashboardFacts`), this decides the
 * order. Adding a step to the timeline is a card id here and a renderer in the dashboard recipe.
 */

/** Paths without fragments are safe to carry through sign-in as `next` (`isSafeReturnPath`). */
export const GUEST_PATHS = {
  portal: '/guests',
  travel: '/guests/travel',
  stay: '/guests/travel#stay',
  flights: '/guests/travel#flights',
  around: '/guests/travel#getting-around',
  things: '/guests/travel#plan',
  ask: '/guests/ask-us',
  venue: '/our-venue',
  rsvp: '/rsvp',
  trip: '/trip',
  ride: '/transportation',
  gifts: '/gifts',
  photos: '/photos',
  story: '/our-story',
} as const;

export interface GuestAction {
  /** Button text: an instruction a grandparent can act on. */
  label: string;
  /** Where it leads once signed in. Never a fragment: it travels through sign-in as `next`. */
  href: string;
}

/** The one action for a state: Home's primary button. */
const ACTION_BY_STATE: Record<LifecycleState, GuestAction> = {
  // The same as the save-the-date: the dashboard already leads with the room block in both.
  TEASER: { label: 'Book your hotel room', href: GUEST_PATHS.travel },
  SAVE_THE_DATE: { label: 'Book your hotel room', href: GUEST_PATHS.travel },
  INVITATIONS_OPEN: { label: 'Open your invitation', href: GUEST_PATHS.portal },
  RSVP_OPEN: { label: 'RSVP', href: GUEST_PATHS.rsvp },
  RSVP_CLOSED: { label: 'Plan your weekend', href: GUEST_PATHS.portal },
  WEDDING_WEEK: { label: 'Your weekend', href: GUEST_PATHS.portal },
  // Not "today": this label is on the public home page, and it would tell a stranger the date.
  WEDDING_DAY: { label: 'Your weekend', href: GUEST_PATHS.portal },
  POST_WEDDING: { label: 'Add your photos', href: GUEST_PATHS.photos },
  ARCHIVE: { label: 'Photos and video', href: GUEST_PATHS.photos },
};

export function currentGuestAction(state: LifecycleState): GuestAction {
  return ACTION_BY_STATE[state];
}

/**
 * Everything the dashboard can show. `tasks` are things to do or check, in priority order for the
 * state; `explore` is the reading that is always there.
 */
export const TASK_CARDS = ['rsvp', 'schedule', 'stay', 'flights', 'around', 'table', 'ride', 'photos', 'gifts'] as const;
export type TaskCard = (typeof TASK_CARDS)[number];
export const EXPLORE_CARDS = ['things', 'venue', 'story', 'ask'] as const;
export type ExploreCard = (typeof EXPLORE_CARDS)[number];

/**
 * Priority order per state. A card that is not in a state's list is not shown in that state.
 *
 * The state sets the ORDER; whether a card appears at all is a fact about this guest (`available`).
 * So the cards that depend on something the couple switch on by hand are listed in every state they
 * could be true in, not only the state it usually happens in: a reply window opened early leads the
 * moment it opens, a table shows from the day seating is published, a ride from the day one is put
 * on the invitation. Listing them only "when expected" left each of those with no way in.
 */
const TASKS_BY_STATE: Record<LifecycleState, readonly TaskCard[]> = {
  TEASER: ['rsvp', 'stay', 'flights', 'around', 'schedule', 'table', 'ride'],
  SAVE_THE_DATE: ['rsvp', 'stay', 'flights', 'around', 'schedule', 'table', 'ride'],
  INVITATIONS_OPEN: ['rsvp', 'schedule', 'stay', 'flights', 'around', 'table', 'ride'],
  RSVP_OPEN: ['rsvp', 'stay', 'flights', 'around', 'schedule', 'table', 'ride', 'gifts'],
  RSVP_CLOSED: ['rsvp', 'schedule', 'stay', 'flights', 'around', 'table', 'ride', 'gifts'],
  WEDDING_WEEK: ['rsvp', 'schedule', 'table', 'ride', 'around', 'gifts'],
  WEDDING_DAY: ['schedule', 'table', 'ride', 'around', 'photos'],
  POST_WEDDING: ['photos', 'gifts'],
  ARCHIVE: ['photos'],
};

const EXPLORE_BY_STATE: Record<LifecycleState, readonly ExploreCard[]> = {
  TEASER: ['things', 'venue', 'story', 'ask'],
  SAVE_THE_DATE: ['things', 'venue', 'story', 'ask'],
  INVITATIONS_OPEN: ['things', 'venue', 'story', 'ask'],
  RSVP_OPEN: ['things', 'venue', 'story', 'ask'],
  RSVP_CLOSED: ['things', 'venue', 'story', 'ask'],
  WEDDING_WEEK: ['things', 'venue', 'ask'],
  WEDDING_DAY: ['venue', 'ask'],
  POST_WEDDING: ['story', 'ask'],
  ARCHIVE: ['story'],
};

/** What is true for this guest right now. Each is a fact the page read, never a guess. */
export interface DashboardFacts {
  /** Null when this guest has no reply to give (no invitation yet, or not theirs to answer). */
  rsvp: { open: boolean; canAnswer: boolean; status: 'not_started' | 'partial' | 'complete' } | null;
  /** The invitation lists at least one event. */
  hasEvents: boolean;
  /** A room block with a way to book it, whose book-by date has not passed. */
  blockOpen: boolean;
  /** Seating is published and this guest has a table. */
  seated: boolean;
  /** A ride benefit is on this guest's invitation. */
  hasRide: boolean;
}

export interface DashboardPlan {
  /** The one thing to do now, or null when nothing needs doing (the page then leads with `next`). */
  lead: TaskCard | null;
  /** Everything else worth acting on, in order. */
  next: TaskCard[];
  /** A reply already on file: shown small, with a way to change it, never as the lead. */
  done: TaskCard[];
  explore: ExploreCard[];
}

function available(card: TaskCard, facts: DashboardFacts, state: LifecycleState): boolean {
  switch (card) {
    case 'rsvp':
      return !!facts.rsvp && facts.rsvp.open && facts.rsvp.canAnswer;
    case 'schedule':
      // The events are on the invitation; before invitations are out there is nothing to show.
      return facts.hasEvents && state !== 'TEASER' && state !== 'SAVE_THE_DATE';
    case 'table':
      return facts.seated;
    case 'ride':
      return facts.hasRide;
    default:
      return true;
  }
}

/** A card that can lead: there is something to do there, not only something to read. */
function actionable(card: TaskCard, facts: DashboardFacts): boolean {
  if (card === 'rsvp') return facts.rsvp?.status !== 'complete';
  if (card === 'stay') return facts.blockOpen;
  return true;
}

/**
 * The dashboard for a state and a guest. The first card in the state's order that the guest can act
 * on leads; an answered RSVP steps aside into `done`; a room block past its book-by date stays as
 * information but no longer leads.
 */
export function planDashboard(state: LifecycleState, facts: DashboardFacts): DashboardPlan {
  const shown = TASKS_BY_STATE[state].filter((card) => available(card, facts, state));
  const done = shown.filter((card) => card === 'rsvp' && facts.rsvp?.status === 'complete');
  const open = shown.filter((card) => !done.includes(card));
  const lead = open.find((card) => actionable(card, facts)) ?? null;
  return { lead, next: open.filter((card) => card !== lead), done, explore: [...EXPLORE_BY_STATE[state]] };
}
