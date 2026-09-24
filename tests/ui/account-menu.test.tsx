import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { navFor } from '@/domain/lifecycle/nav';
import { getTheme } from '@/themes';
import { THEME_IDS } from '@/themes/registry';
import { AccountMenu } from '@/themes/shared/AccountMenu';

const CLASSES = { link: 'nav-link', item: 'menu-link' };
const MEMBER = ['/rsvp', '/your-weekend', '/transportation', '/gifts', '/photos'];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the account menu', () => {
  it('is only "Sign in" to a reader without a session: none of the household pages are linked', () => {
    render(<AccountMenu nav={navFor('RSVP_OPEN', { signedIn: false })} variant="popover" classNames={CLASSES} />);
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in');
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelectorAll('a')).toHaveLength(1);
  });

  it('opens on a signed-in reader to RSVP, their weekend, transport, gifts and photos, then Sign out', () => {
    render(<AccountMenu nav={navFor('RSVP_OPEN', { signedIn: true })} variant="popover" classNames={CLASSES} />);
    const trigger = screen.getByRole('button', { name: 'Your account' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([...MEMBER, '/sign-out']);
    // Escape closes it and puts focus back on the button.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('asks /api/session on a prerendered page, and opens itself only on a yes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ signedIn: true }), { status: 200 }));
    render(<AccountMenu nav={navFor('RSVP_OPEN')} variant="inline" classNames={CLASSES} />);
    // Before the answer — and with JavaScript off — it is the plain way in.
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('group', { name: 'Your account' })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([...MEMBER, '/sign-out']);
  });
});

describe('every design keeps the household pages out of its chrome for an anonymous reader', () => {
  it.each(THEME_IDS)('%s', (theme) => {
    const { Nav } = getTheme(theme).kit;
    for (const state of LIFECYCLE_STATES) {
      // `signedIn: false` rather than the probe: the probe answers once per page load, and the test
      // above already spent this file's answer on a yes.
      const { container, unmount } = render(<Nav nav={navFor(state, { currentPath: '/', signedIn: false })} siteName="Sara + Tyler" homeLabel="Home" switcherEnabled={false} />);
      const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
      for (const href of MEMBER) expect(hrefs, `${theme} ${state}: ${href}`).not.toContain(href);
      expect(hrefs, `${theme} ${state}`).toContain('/sign-in');
      unmount();
    }
  });
});
