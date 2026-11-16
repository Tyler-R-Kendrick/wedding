import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionProbe } from '@/themes/shared/session-hint';

/**
 * The session answer is kept for one page, not for the tab. The root layout asks on every page,
 * the console included, and moving between pages does not reload the tab: kept for the tab, the
 * console page's answer would be handed to the guest pages, and an administrator who starts
 * browsing as a guest would see no "Inspecting as" band.
 */
const answer = (body: object) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

describe('the session probe', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/admin/guests');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks once for a page, however many parts of it ask', async () => {
    fetchMock.mockImplementation(() => answer({ signedIn: true, admin: true, distinctId: 'A1' }));
    const [a, b] = await Promise.all([sessionProbe(true), sessionProbe()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a).toMatchObject({ resolved: true, signedIn: true, admin: true, viewAs: null });
  });

  it('asks again on another page, so a guest page hears who is being browsed as', async () => {
    fetchMock.mockImplementationOnce(() => answer({ signedIn: true, admin: true, distinctId: 'A1' }));
    expect((await sessionProbe(true)).viewAs).toBeNull();

    // "Browse as" lands on the guest dashboard without a reload.
    window.history.pushState({}, '', '/guests');
    fetchMock.mockImplementationOnce(() => answer({ signedIn: true, admin: true, distinctId: 'A1', viewAs: { name: 'Ana', household: 'Testhouse household', readOnly: true } }));
    expect((await sessionProbe()).viewAs).toEqual({ name: 'Ana', household: 'Testhouse household', readOnly: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forgets a failed request, so the next part of the page asks again', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    expect(await sessionProbe(true)).toMatchObject({ resolved: false, signedIn: false });
    fetchMock.mockImplementationOnce(() => answer({ signedIn: true, distinctId: 'G1' }));
    expect(await sessionProbe()).toMatchObject({ resolved: true, signedIn: true });
  });
});
