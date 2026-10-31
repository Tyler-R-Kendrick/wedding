import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The band's server action is a module the test DOM cannot run; the band only needs its reference.
vi.mock('@/components/guest-view/actions', () => ({ stopGuestView: vi.fn(), stopViewRole: vi.fn() }));

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

describe('the preview band', () => {
  it('shows view-role preview with return to admin', async () => {
    await renderBand({ signedIn: true, admin: true, viewRole: { role: 'guest', label: 'Invited guest', readOnly: true }, viewAs: null });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('View as: Invited guest'));
    expect(screen.getByRole('button', { name: 'Return to admin' })).toBeTruthy();
  });

  it('says whose guest profile is inspected, that it is read-only, and offers the way to stop', async () => {
    await renderBand({ signedIn: true, admin: false, viewAs: { name: 'Ana Ruiz', household: 'The Ruiz household', readOnly: true }, viewRole: null });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Inspecting as Ana Ruiz (The Ruiz household).'));
    expect(screen.getByRole('status').textContent).toContain('Read-only');
    expect(screen.getByRole('button', { name: 'Stop inspecting as Ana Ruiz' })).toBeTruthy();
  });

  it('does not repeat the name when the household is named after the guest', async () => {
    await renderBand({ signedIn: true, admin: false, viewAs: { name: 'Ana Ruiz', household: 'Ana Ruiz & Guest', readOnly: true }, viewRole: null });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Inspecting as Ana Ruiz\. /));
  });

  it('on the administrator’s own record it is not read-only', async () => {
    await renderBand({ signedIn: true, admin: false, viewAs: { name: 'Tyler', household: '', readOnly: false }, viewRole: null });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('This is your own guest record.'));
  });

  it.each([
    ['a guest', { signedIn: true, admin: false, viewAs: null, viewRole: null }],
    ['an administrator', { signedIn: true, admin: true, viewAs: null, viewRole: null }],
    ['a reader with no session', { signedIn: false }],
  ])('renders nothing for %s', async (_, body) => {
    const { container } = await renderBand(body);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });
});
