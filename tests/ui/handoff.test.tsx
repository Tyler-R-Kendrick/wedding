import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfirmationCard } from '@/components/handoff/ConfirmationCard';
import { ExternalHandoffCard } from '@/components/handoff/ExternalHandoffCard';
import { GiftsPageRecipe } from '@/components/handoff/page-recipes';
import { ReservationHandoffCard } from '@/components/handoff/ReservationHandoffCard';
import { UnavailableCard } from '@/components/handoff/UnavailableCard';
import { FORBIDDEN_GIFT_WORDS, GIFTS_COPY } from '@/domain/gifts/copy';

const handoff = { provider: 'zola', providerDisplayName: 'Zola', label: 'Continue securely with Zola', url: 'https://www.zola.com/registry/x', host: 'www.zola.com', opensNewTab: true, disclosure: 'You will leave our site.' };

afterEach(cleanup);

describe('handoff cards', () => {
  it('names the provider, opens safely in a new tab, and prints the URL', () => {
    render(<ExternalHandoffCard heading="Our wishlist" handoff={handoff} placeholder testMode />);
    const link = screen.getByRole('link', { name: /Continue securely with Zola/ });
    expect(link.getAttribute('href')).toBe(handoff.url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
    expect(screen.getByText(/via Zola/)).toBeTruthy();
    expect(screen.getByText(/Test mode/)).toBeTruthy();
    expect(screen.getByText(/Not final yet/)).toBeTruthy();
    expect(document.querySelector('.print\\:block')?.textContent).toBe(handoff.url);
    expect(document.querySelector('[data-handoff-host]')?.getAttribute('data-handoff-host')).toBe('www.zola.com');
  });

  it('renders the honest unavailable rung with the contact route, never a fake button', () => {
    render(<ReservationHandoffCard option={{ venue: { id: 'p', name: 'TODO(Tyler & Sara): a restaurant', note: null, placeholder: true, verifiedAt: null, sourceId: null }, rung: 'unavailable', canCommit: false, unavailable: { message: 'Not yet. Ask us.', contactRoute: '/ask-us' } }} />);
    expect(screen.queryByRole('link', { name: /Continue|Reserve/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Ask us' }).getAttribute('href')).toBe('/ask-us');
    expect(screen.getByText(/not bookable here yet/)).toBeTruthy();
    render(<UnavailableCard heading="X" message="m" />);
    expect(screen.getAllByRole('link', { name: 'Ask us' }).length).toBeGreaterThan(1);
  });

  it('confirmation card lists what is being agreed to', () => {
    render(
      <ConfirmationCard title="Claim your ride benefit" rows={[{ label: 'Amount', value: 'To be confirmed' }]} disclosure="Once only.">
        <button type="button">Confirm and claim</button>
      </ConfirmationCard>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Claim your ride benefit' })).toBeTruthy();
    expect(screen.getByText('Amount')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm and claim' })).toBeTruthy();
  });

  it('gifts recipe frames "next adventures", names each provider, and never says cash fund or donate', () => {
    const link = { ...handoff, id: 'r', kind: 'registry' as const, note: null, placeholder: true, origin: 'placeholder' as const, verifiedAt: null };
    render(<GiftsPageRecipe data={{ copy: GIFTS_COPY, links: [link, { ...link, id: 'a', kind: 'adventure-fund' as const, providerDisplayName: 'Joy', provider: 'withjoy' }] }} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Help us with our next adventures');
    expect(screen.getByText(/via Zola/)).toBeTruthy();
    expect(screen.getByText(/via Joy/)).toBeTruthy();
    const text = document.body.textContent ?? '';
    for (const re of FORBIDDEN_GIFT_WORDS) expect(text).not.toMatch(re);
    expect(document.querySelectorAll('input')).toHaveLength(0); // never a checkout form
  });
});
