import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MyItinerary } from '@/capabilities/rsvp';
import { Dashboard, type DashboardData } from '@/components/weekend/Dashboard';
import type { LifecycleState } from '@/contracts/lifecycle';
import { planDashboard, type DashboardFacts } from '@/domain/lifecycle/guest-actions';
import { DEFAULT_VENUE_BLOCK } from '@/domain/travel/facts';

const HOTEL = 'Chicago Athletic Association Hotel';

function itinerary(over: Partial<MyItinerary['rsvp']> = {}): MyItinerary {
  const part = (p: 'attendance' | 'plus_one' | 'meal' | 'notes', state: 'open' | 'later') => ({ part: p, state, reason: state === 'later' ? ('not_released' as const) : null, status: state === 'open' ? ('not_started' as const) : ('later' as const), expected: 2, answered: 0, attention: 0 });
  return {
    greeting: { firstName: 'Ada', householdName: 'Testhouse household' },
    lifecycle: 'RSVP_OPEN',
    rsvp: {
      window: { open: true, reason: 'manual_open', mode: 'open', deadlineAt: '2027-06-01T05:00:00.000Z', lifecycle: 'RSVP_OPEN' },
      status: 'not_started',
      answered: 0,
      expected: 2,
      canAnswer: true,
      scope: 'household',
      parts: [part('attendance', 'open'), part('meal', 'later')],
      next: ['attendance'],
      ...over,
    },
    events: [
      { id: 'e1', slug: 'ceremony', name: 'Ceremony', description: null, dateIso: '2027-07-17', startsAt: null, endsAt: null, timezone: 'America/Chicago', venueSpaceRef: null, dressCode: null, accessibilityNote: null, placeholder: true, rsvpRequired: true, hasMeal: false, mealOptionsVersion: 0, sortOrder: 1, mealOptions: [], whenText: 'Time to be confirmed', dateText: 'Saturday, July 17, 2027', household: [] },
    ],
    seating: { published: false, state: 'not_published', message: 'Your table will appear here once seating is published.', table: null },
    slots: {
      transport: { kind: 'transport', status: 'ready', placeholder: false, title: 'Getting there and home', items: [] },
      trip: { kind: 'trip', status: 'ready', placeholder: false, title: 'Your trip', items: [] },
    },
    notices: [],
  } as unknown as MyItinerary;
}

function data(state: LifecycleState, facts: DashboardFacts, it: MyItinerary | null): DashboardData {
  return {
    firstName: 'Ada',
    state,
    plan: planDashboard(state, facts),
    when: 'Saturday, July 17, 2027',
    where: { name: HOTEL, city: 'Chicago' },
    daysToGo: 250,
    itinerary: it,
    hotel: { name: HOTEL, block: DEFAULT_VENUE_BLOCK },
    blockOpen: facts.blockOpen,
  };
}

const SAVE_THE_DATE: DashboardFacts = { rsvp: null, hasEvents: false, blockOpen: true, seated: false, hasRide: false };

describe('the guest dashboard', () => {
  it('greets the guest and says when and where, with no photograph across the top', () => {
    const { container } = render(<Dashboard data={data('SAVE_THE_DATE', SAVE_THE_DATE, null)} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome, Ada');
    expect(screen.getByText('Saturday, July 17, 2027')).toBeTruthy();
    expect(screen.getByText('250 days to go')).toBeTruthy();
    expect(container.querySelector('img, picture')).toBeNull();
    // The old portal repeated the site navigation as a row of tabs under its hero.
    expect(container.querySelector('nav[aria-label="Your weekend"]')).toBeNull();
  });

  it('leads with the room block while the save-the-dates are out: the rate, the date, one button', () => {
    const { container } = render(<Dashboard data={data('SAVE_THE_DATE', SAVE_THE_DATE, null)} />);
    const card = container.querySelector<HTMLElement>('.dash-lead')!;
    expect(within(card).getByRole('heading', { level: 2 }).textContent).toBe('Our room block');
    expect(within(card).getByText('$331–371 per night')).toBeTruthy();
    expect(within(card).getByText('Book by June 15, 2027')).toBeTruthy();
    expect(within(card).getByText('Friday, July 16 and Saturday, July 17, 2027')).toBeTruthy();
    expect(within(card).getByRole('link', { name: '844-312-2221' }).getAttribute('href')).toBe('tel:+18443122221');
    const book = within(card).getByRole('link', { name: /Book your room/ });
    expect(book.getAttribute('href')).toBe(DEFAULT_VENUE_BLOCK.url);
    expect(book.getAttribute('rel')).toContain('noopener');
    expect(book.textContent).toContain('opens the hotel’s booking page');
    expect(within(card).getAllByRole('link').filter((a) => a.classList.contains('btn--primary'))).toHaveLength(1);
  });

  it('then offers flights and getting around, each leading to its place on Travel', () => {
    render(<Dashboard data={data('SAVE_THE_DATE', SAVE_THE_DATE, null)} />);
    expect(screen.getByRole('link', { name: 'Search flights' }).getAttribute('href')).toBe('/guests/travel#flights');
    expect(screen.getByRole('link', { name: 'Trains, rides and parking' }).getAttribute('href')).toBe('/guests/travel#getting-around');
  });

  it('shows nothing a guest cannot use yet: no table, no photos, no gifts, no RSVP', () => {
    const { container } = render(<Dashboard data={data('SAVE_THE_DATE', SAVE_THE_DATE, null)} />);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    for (const hidden of ['/photos', '/media/upload', '/gifts', '/rsvp', '/transportation']) expect(hrefs, hidden).not.toContain(hidden);
    expect(container.textContent).not.toMatch(/your table|seating|photos|video|registry/i);
    // And nothing about rides that has not been decided.
    expect(container.textContent).not.toMatch(/coming soon|pickup/i);
  });

  it('says each thing once: no heading or destination is repeated', () => {
    const { container } = render(<Dashboard data={data('SAVE_THE_DATE', SAVE_THE_DATE, null)} />);
    const headings = [...container.querySelectorAll('h2, h3')].map((h) => h.textContent);
    expect(new Set(headings).size).toBe(headings.length);
    const internal = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter((h) => h?.startsWith('/'));
    expect(new Set(internal).size).toBe(internal.length);
  });

  it('puts the RSVP in the lead once replies open, with its deadline and its parts', () => {
    const it = itinerary();
    const facts: DashboardFacts = { rsvp: { open: true, canAnswer: true, status: 'not_started' }, hasEvents: true, blockOpen: true, seated: false, hasRide: false };
    const { container } = render(<Dashboard data={data('RSVP_OPEN', facts, it)} />);
    const card = container.querySelector<HTMLElement>('.dash-lead')!;
    expect(within(card).getByRole('heading', { level: 2 }).textContent).toBe('RSVP');
    expect(card.textContent).toMatch(/Kindly reply by/);
    expect(within(card).getByRole('link', { name: 'RSVP now' }).getAttribute('href')).toBe('/rsvp');
    // The room block is still there to book, one step down.
    expect(screen.getByRole('heading', { level: 3, name: 'Our room block' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Your schedule' })).toBeTruthy();
  });

  it('steps an answered RSVP aside and gives the lead back to what is left', () => {
    const it = itinerary({ status: 'complete', answered: 2, next: [] });
    const facts: DashboardFacts = { rsvp: { open: true, canAnswer: true, status: 'complete' }, hasEvents: true, blockOpen: true, seated: false, hasRide: false };
    const { container } = render(<Dashboard data={data('RSVP_OPEN', facts, it)} />);
    expect(within(container.querySelector<HTMLElement>('.dash-lead')!).getByRole('heading', { level: 2 }).textContent).toBe('Our room block');
    expect(screen.getByText('RSVP answered for everyone')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Review or change your RSVP' }).getAttribute('href')).toBe('/rsvp');
  });

  it('keeps one h1 and never skips a heading level', () => {
    const it = itinerary();
    const facts: DashboardFacts = { rsvp: { open: true, canAnswer: true, status: 'not_started' }, hasEvents: true, blockOpen: true, seated: false, hasRide: false };
    const { container } = render(<Dashboard data={data('RSVP_OPEN', facts, it)} />);
    const levels = [...container.querySelectorAll('h1, h2, h3, h4')].map((h) => Number(h.tagName[1]));
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
  });
});
