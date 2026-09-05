import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TravelPageRecipe, type TravelPageData } from '@/app/(public)/travel/recipe';
import { AIRPORTS, BRIEF_CITATION, synthesizedVenueHotel, VENUE } from '@/domain/travel';

const data: TravelPageData = {
  venue: synthesizedVenueHotel(new Date('2026-09-05T00:00:00Z')),
  alternatives: [],
  facts: { venue: { name: VENUE.name, address: VENUE.address, url: VENUE.url, faqUrl: VENUE.faqUrl, valetEntrance: VENUE.valetEntrance, valetNote: VENUE.valetNote }, airports: AIRPORTS.map((a) => ({ ...a })) },
  sources: [BRIEF_CITATION],
  viewer: { kind: 'anonymous', hasProfile: false },
};

describe('Travel & Stay recipe', () => {
  it('renders landmarks, the block first with honest placeholders, both airports, and no live search on load', () => {
    render(<TravelPageRecipe data={data} slots={{ flightSearch: <p>flight-search-slot</p>, hotelSearch: <p>hotel-search-slot</p> }} />);
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Getting to Chicago');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Two airports serve Chicago', 'Where to stay', 'Search flights', 'Check hotel rates', 'Getting around', 'Your trip']);
    expect(screen.getByRole('heading', { level: 3, name: 'Chicago Athletic Association Hotel' })).toBeTruthy();
    expect(screen.getByText('ORD')).toBeTruthy();
    expect(screen.getByText('MDW')).toBeTruthy();
    const text = document.body.textContent ?? '';
    expect(text).toContain('TODO(Tyler & Sara): rate from the planner');
    expect(text).toContain('TODO(Tyler & Sara): cutoff date');
    expect(text).toContain('up to 20 rooms');
    expect(text).not.toMatch(/\$\d/); // no invented prices
    expect(text).not.toMatch(/safe(st)?\b/i); // no safety claims
    expect(screen.getByText('flight-search-slot')).toBeTruthy();
    expect(screen.getByText('hotel-search-slot')).toBeTruthy();
    const external = Array.from(document.querySelectorAll('a[target="_blank"]'));
    expect(external.length).toBeGreaterThan(0);
    for (const a of external) expect(a.getAttribute('rel')).toContain('noopener');
    expect(screen.getByRole('link', { name: /Visit the hotel website/ }).getAttribute('href')).toBe('https://www.chicagoathletichotel.com/');
    expect(screen.getByRole('link', { name: /12 S Michigan Ave/ }).getAttribute('href')).toContain('https://www.google.com/maps/search/');
  });
});
