import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIFECYCLE_STATES, type LifecycleState } from '@/contracts/lifecycle';
import { SEED_SITE } from '@/db/seed/seed';
import { toSiteFacts } from '@/domain/lifecycle/facts';
import { navFor } from '@/domain/lifecycle/nav';
import { getTheme } from '@/themes';
import { THEME_IDS } from '@/themes/registry';
import { AccountMenu } from '@/themes/shared/AccountMenu';

const CLASSES = { link: 'nav-link', item: 'menu-link' };
/** What is left for the account menu once RSVP is in the guest's primary navigation, by state. */
const MEMBER: Record<LifecycleState, string[]> = {
  TEASER: [],
  SAVE_THE_DATE: [],
  INVITATIONS_OPEN: [],
  RSVP_OPEN: ['/gifts'],
  RSVP_CLOSED: ['/gifts'],
  WEDDING_WEEK: ['/gifts'],
  WEDDING_DAY: ['/photos', '/gifts'],
  POST_WEDDING: ['/photos', '/gifts'],
  ARCHIVE: ['/photos'],
};
/** Every page that says when or where the wedding is, or is a household's own. */
const WEDDING_PAGES = ['/guests', '/guests/travel', '/guests/things-to-do', '/guests/ask-us', '/our-venue', '/rsvp', '/transportation', '/trip', '/gifts', '/photos', '/your-weekend', '/the-wedding', '/travel', '/share-an-adventure', '/ask-us'];
const GUEST_PORTALS = [{ label: 'Guest Portal', href: '/guests' }];

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

  it('opens on a signed-in reader to their dashboard and what they can use now, then Sign out', () => {
    render(<AccountMenu nav={{ ...navFor('RSVP_OPEN', { signedIn: true }), portals: GUEST_PORTALS }} variant="popover" classNames={CLASSES} />);
    const trigger = screen.getByRole('button', { name: 'Your account' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/guests', '/gifts', '/sign-out']);
    // Escape closes it and puts focus back on the button.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('offers an administrator the admin portal and preview tools, not a household they do not have', () => {
    render(<AccountMenu nav={{ ...navFor('RSVP_OPEN', { signedIn: true, admin: true }), portals: [{ label: 'Admin Portal', href: '/admin' }] }} variant="inline" classNames={CLASSES} />);
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/admin', '/admin#view-as', '/admin/guests#inspect-guest', '/sign-out']);
  });

  it('while an administrator previews a role: portal links, that household\'s pages, then Sign out', () => {
    render(
      <AccountMenu
        nav={{ ...navFor('RSVP_OPEN', { signedIn: true, viewing: true }), portals: [{ label: 'Guest Portal', href: '/guests' }, { label: 'Admin Portal', href: '/admin' }] }}
        variant="inline"
        classNames={CLASSES}
      />,
    );
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/guests', '/admin', '/gifts', '/sign-out']);
  });

  it.each(LIFECYCLE_STATES)('%s: lists only what a guest can use in that state, with no Your Weekend or Transportation', (state) => {
    const { unmount } = render(<AccountMenu nav={{ ...navFor(state, { signedIn: true }), portals: GUEST_PORTALS }} variant="inline" classNames={CLASSES} />);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/guests', ...MEMBER[state], '/sign-out']);
    const labels = links.map((a) => a.textContent);
    expect(labels).not.toContain('Your Weekend');
    expect(labels).not.toContain('Transportation');
    unmount();
  });

  it('asks /api/session on a prerendered page, and opens itself only on a yes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ signedIn: true, portals: [{ label: 'Guest Portal', href: '/guests' }] }), { status: 200 }),
    );
    render(<AccountMenu nav={navFor('RSVP_OPEN')} variant="inline" classNames={CLASSES} />);
    // Before the answer — and with JavaScript off — it is the plain way in.
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('group', { name: 'Your account' })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
    // A prerendered page has the public navigation, so the RSVP is offered here rather than in it.
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/guests', '/rsvp', '/gifts', '/sign-out']);
  });
});

describe('every design keeps the wedding out of its chrome for an anonymous reader', () => {
  it.each(THEME_IDS)('%s', (theme) => {
    const { Nav } = getTheme(theme).kit;
    const venue = toSiteFacts({ ...SEED_SITE }).venue;
    for (const state of LIFECYCLE_STATES) {
      // `signedIn: false` rather than the probe: the probe answers once per page load, and the test
      // above already spent this file's answer on a yes. The venue is handed over to show it is not used.
      const { container, unmount } = render(<Nav nav={navFor(state, { currentPath: '/', signedIn: false, venue })} siteName="Sara + Tyler" homeLabel="Home" switcherEnabled={false} />);
      const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
      for (const href of WEDDING_PAGES) expect(hrefs, `${theme} ${state}: ${href}`).not.toContain(href);
      // Home, the two pages about the couple, and the way in. Nothing else, in any state.
      for (const href of hrefs) expect(['/', '/our-story', '/our-adventures', '/sign-in'], `${theme} ${state}: ${href}`).toContain(href);
      expect(hrefs, `${theme} ${state}`).toContain('/sign-in');
      expect(hrefs, `${theme} ${state}`).toContain('/our-story');
      const text = container.textContent ?? '';
      expect(text, `${theme} ${state}`).not.toMatch(/Directions|Venue|Travel|Things to Do|Ask Us|RSVP|Gifts|Photos|Today|Now\b/);
      expect(text, `${theme} ${state}`).not.toMatch(/Chicago|Michigan|July|2027/);
      unmount();
    }
  });
});
