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

function frame(theme: ThemeId): PageFrame {
  const site = toSiteFacts({ ...SEED_SITE });
  return {
    theme, site, switcherEnabled: false, countdown: countdownView(new Date('2026-10-18T12:00:00Z')),
    lifecycle: { state: 'SAVE_THE_DATE', mode: 'explore', persistedState: 'SAVE_THE_DATE', preview: null, suggested: 'SAVE_THE_DATE', publishedAt: null, note: null },
    nav: navFor('SAVE_THE_DATE', { venue: site.venue, currentPath: '/travel' }),
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
  it('offers sign-in to a public visitor without printing group booking fields', () => {
    const Recipe = getTheme(theme).content!.travel!;
    render(<Recipe {...props} frame={frame(theme)} signedIn={false} tripHref="/sign-in?next=%2Ftrip" />);
    expect(screen.getByRole('link', { name: 'Sign in for room-block details as they are confirmed →' }).getAttribute('href')).toBe('/sign-in?next=%2Ftravel');
    expect(document.body.textContent).not.toContain('Group rate');
    expect(document.body.textContent).not.toContain('Booking code');
  });

  it('shows an honest pending state instead of asking an authenticated guest to sign in again', () => {
    const Recipe = getTheme(theme).content!.travel!;
    render(<Recipe {...props} frame={frame(theme)} signedIn tripHref="/trip" />);
    expect(screen.getByText(/Room-block details are being confirmed/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Sign in for/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Your guest travel details and weekend plans →' }).getAttribute('href')).toBe('/trip');
  });
});
