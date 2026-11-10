import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SEED_SITE } from '@/db/seed/seed';
import { toSiteFacts } from '@/domain/lifecycle/facts';
import { countdownView } from '@/domain/lifecycle/countdown';
import { navFor } from '@/domain/lifecycle/nav';
import { AIRPORTS, BRIEF_CITATION, synthesizedVenueHotel, VENUE } from '@/domain/travel';
import { getTheme } from '@/themes';
import { THEME_IDS } from '@/themes/registry';
import type { PageFrame, ThemeId } from '@/themes/types';

/** Travel & Stay is a guest page: its frame is always a signed-in reader's, on the portal address. */
function frame(theme: ThemeId): PageFrame {
  const full = toSiteFacts({ ...SEED_SITE });
  return {
    theme,
    site: { coupleDisplayName: full.coupleDisplayName, partner1: full.partner1, partner2: full.partner2 },
    details: { date: full.date, venue: full.venue, countdown: countdownView(new Date('2026-10-18T12:00:00Z')) },
    lifecycle: { state: 'SAVE_THE_DATE', mode: 'explore', persistedState: 'SAVE_THE_DATE', preview: null, suggested: 'SAVE_THE_DATE', publishedAt: null, note: null },
    nav: navFor('SAVE_THE_DATE', { venue: full.venue, currentPath: '/guests/travel', signedIn: true }),
  };
}

const props = {
  venue: { ...synthesizedVenueHotel(new Date('2026-10-18T12:00:00Z')), block: null },
  alternatives: [],
  facts: { venue: { ...VENUE }, airports: AIRPORTS.map((a) => ({ ...a })) },
  sources: [BRIEF_CITATION],
  slots: { flightSearch: <p>Flights</p>, hotelSearch: <p>Hotels</p> },
};

describe.each(THEME_IDS)('Travel identity and pending bookings (%s)', (theme) => {
  it('shows Sara’s upgraded-room note and published valet rate', () => {
    const Recipe = getTheme(theme).content!.travel!;
    render(<Recipe {...props} frame={frame(theme)} signedIn={false} tripHref="/sign-in?next=%2Ftrip" />);
    expect(document.body.textContent).toMatch(/upgraded room or an extended stay.*let us know/i);
    expect(document.body.textContent).toMatch(/\$84/);
    expect(document.body.textContent).not.toMatch(/special event valet/i);
  });

  it('never prints group booking fields before the block is confirmed, and its only sign-in door comes back to the portal page', () => {
    // The page asks for a session before it renders, so `signedIn={false}` is an administrator: a
    // reader the page does not know as a guest. The two earlier proposals still offer them the door.
    const Recipe = getTheme(theme).content!.travel!;
    render(<Recipe {...props} frame={frame(theme)} signedIn={false} tripHref="/sign-in?next=%2Ftrip" />);
    expect(document.body.textContent).not.toContain('Group rate');
    expect(document.body.textContent).not.toContain('Booking code');
    const doors = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '').filter((href) => href.startsWith('/sign-in'));
    // Every door returns to a guest page that exists; none to the public page that was removed.
    for (const href of doors) expect(['/sign-in?next=%2Fguests%2Ftravel', '/sign-in?next=%2Ftrip'], href).toContain(href);
    expect(doors).not.toContain('/sign-in?next=%2Ftravel');
    if (theme === 'botanical-deco') {
      // The approved design says the same thing to everyone who can read the page.
      expect(screen.getByText(/Room-block details are being confirmed/)).toBeTruthy();
      expect(screen.queryByRole('link', { name: /Sign in for/ })).toBeNull();
    } else {
      expect(screen.getByRole('link', { name: 'Sign in for room-block details as they are confirmed →' }).getAttribute('href')).toBe('/sign-in?next=%2Fguests%2Ftravel');
    }
  });

  it('shows an honest pending state instead of asking an authenticated guest to sign in again', () => {
    const Recipe = getTheme(theme).content!.travel!;
    render(<Recipe {...props} frame={frame(theme)} signedIn tripHref="/trip" />);
    expect(screen.getByText(/Room-block details are being confirmed/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Sign in for/ })).toBeNull();
    expect([...document.querySelectorAll('main a')].some((a) => (a.getAttribute('href') ?? '').startsWith('/sign-in'))).toBe(false);
    const trip = theme === 'botanical-deco' ? 'Keep your plans in one place' : 'Your guest travel details and weekend plans →';
    expect(screen.getByRole('link', { name: trip }).getAttribute('href')).toBe('/trip');
  });

  it('promises no ride pickup or ride benefit that nobody has arranged, and links to no page that was removed', () => {
    const Recipe = getTheme(theme).content!.travel!;
    render(<Recipe {...props} frame={frame(theme)} signedIn tripHref="/trip" />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Rideshare pickup details|coming soon|Uber can take you/i);
    expect(text).not.toContain('TODO(');
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    for (const href of hrefs) expect(href, href).not.toMatch(/^\/(travel|the-wedding|your-weekend|share-an-adventure|ask-us)(\/|$|#|\?)/);
  });
});

describe('Travel & Stay in the approved design', () => {
  it('is one page in four parts: where to stay, flights, getting around, and making a trip of it', () => {
    const Recipe = getTheme('botanical-deco').content!.travel!;
    const { container } = render(<Recipe {...props} frame={frame('botanical-deco')} signedIn tripHref="/trip" />);
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Plan your trip']);
    const main = screen.getByRole('main');
    expect([...main.querySelectorAll('section[id]')].map((el) => el.id)).toEqual(['stay', 'flights', 'getting-around', 'make-a-trip']);
    expect([...main.querySelectorAll('section[id] h2')].map((h) => h.textContent)).toEqual(['Where to stay', 'Flights', 'Getting around', 'Make a trip of it']);
    // The airports, arriving and hotel-rates sections are folded into those four.
    for (const gone of ['airports', 'arriving', 'hotel-rates']) expect(container.querySelector(`#${gone}`), gone).toBeNull();
    // The hotel rate search is still here, closed until asked for, inside Where to stay.
    const compare = main.querySelector('#stay details');
    expect(compare).not.toBeNull();
    expect(compare!.hasAttribute('open')).toBe(false);
    expect(compare!.textContent).toContain('Hotels');
    expect(main.querySelector('#flights')!.textContent).toContain('Flights');
    // No "Based on: …" sources line under the page.
    expect(main.textContent).not.toMatch(/Based on:/);
    expect(main.textContent).not.toContain(BRIEF_CITATION.title);
    // The "On this page" chips name the first three parts.
    expect(['#stay', '#flights', '#getting-around'].every((hash) => main.querySelector(`a[href="${hash}"]`) !== null)).toBe(true);
  });
});
