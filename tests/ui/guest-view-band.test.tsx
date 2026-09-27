import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The band's server action is a module the test DOM cannot run; the band only needs its reference.
vi.mock('@/components/guest-view/actions', () => ({ stopGuestView: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

/** A fresh module per test: the session probe is shared per page load, so each test is a new page. */
async function renderBand(body: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  const { GuestViewBand } = await import('@/components/guest-view/GuestViewBand');
  return render(<GuestViewBand />);
}

describe('the "Browse as a guest" band', () => {
  it('says whose view it is, that it is read-only, and offers the way to stop', async () => {
    await renderBand({ signedIn: true, admin: false, viewAs: { name: 'Ana Ruiz', household: 'The Ruiz household', readOnly: true } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Browsing as Ana Ruiz (The Ruiz household).'));
    expect(screen.getByRole('status').textContent).toContain('Read-only');
    expect(screen.getByRole('button', { name: 'Stop browsing as Ana Ruiz' })).toBeTruthy();
  });

  it('does not repeat the name when the household is named after the guest', async () => {
    await renderBand({ signedIn: true, admin: false, viewAs: { name: 'Ana Ruiz', household: 'Ana Ruiz & Guest', readOnly: true } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Browsing as Ana Ruiz\. /));
  });

  it('on the administrator’s own record it is not read-only', async () => {
    await renderBand({ signedIn: true, admin: false, viewAs: { name: 'Tyler', household: '', readOnly: false } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('This is your own guest record.'));
  });

  it.each([
    ['a guest', { signedIn: true, admin: false, viewAs: null }],
    ['an administrator', { signedIn: true, admin: true, viewAs: null }],
    ['a reader with no session', { signedIn: false }],
  ])('renders nothing for %s', async (_, body) => {
    const { container } = await renderBand(body);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });
});
