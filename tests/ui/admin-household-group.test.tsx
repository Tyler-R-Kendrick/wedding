import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseholdGroup, type HouseholdGroupRow } from '@/app/(admin)/admin/invitations/_components/HouseholdGroup';

/*
 * The bulk group on /admin/invitations. Ticking saves; an action names what it will change before
 * it changes it; a household with no link is skipped by "Mark as sent" and said so; and the links
 * a bulk make shows once stay on screen through the refresh that follows, and are kept nowhere.
 */

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
const fetchMock = vi.fn();

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const answer = (body: unknown) => Promise.resolve({ json: () => Promise.resolve(body) } as Response);
const sent = (call: number) => JSON.parse(String((fetchMock.mock.calls[call]?.[1] as RequestInit).body)) as { input: Record<string, unknown> };
const home = (id: string, name: string, over: Partial<HouseholdGroupRow> = {}): HouseholdGroupRow => ({ id, name, people: 2, inGroup: false, link: 'none', sentAt: null, ...over });
const EVENTS = [
  { value: 'ceremony', label: 'Ceremony' },
  { value: 'reception', label: 'Reception' },
];
const ROWS = [home('a', 'The Lovelaces'), home('b', 'The Babbages', { link: 'active' }), home('c', 'The Hoppers', { link: 'active', sentAt: '2026-11-01T18:00:00.000Z' })];
const show = (rows: HouseholdGroupRow[], shownIds = rows.map((r) => r.id)) => <HouseholdGroup rows={rows} shownIds={shownIds} events={EVENTS} defaultEvents={['ceremony', 'reception']} filtered={shownIds.length !== rows.length} />;
const tick = (name: string) => screen.getByRole('checkbox', { name: `In the group: ${name}` });

describe('the bulk group', () => {
  it('saves a tick as it is made, and puts it back if the save does not land', async () => {
    render(show(ROWS));
    expect(screen.getByTestId('group-count').textContent).toBe('Nobody in the group');
    // Nothing to act on yet: every action is there, unavailable, and says why.
    for (const name of ['Make links', 'Mark as sent', 'Mark as not sent']) expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/Tick households to put them in the group/)).toBeTruthy();

    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { changed: 1 } }));
    fireEvent.click(tick('The Lovelaces'));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/capabilities/admin_set_bulk_group');
    expect(sent(0).input).toEqual({ householdIds: ['a'], inGroup: true });
    await waitFor(() => expect(screen.getByTestId('group-count').textContent).toBe('1 household in the group'));
    expect((tick('The Lovelaces') as HTMLInputElement).checked).toBe(true);

    fetchMock.mockReturnValueOnce(answer({ ok: false, error: { code: 'unavailable', message: 'The group could not be saved.' } }));
    fireEvent.click(tick('The Babbages'));
    await waitFor(() => expect(screen.getByText('The group could not be saved.')).toBeTruthy());
    expect((tick('The Babbages') as HTMLInputElement).checked).toBe(false);
    expect((tick('The Lovelaces') as HTMLInputElement).checked).toBe(true);
  });

  it('“All shown” puts every household shown in the group in one save, and counts the ones a filter hides', async () => {
    const rows = [home('a', 'The Lovelaces', { inGroup: true }), home('b', 'The Babbages'), home('c', 'The Hoppers')];
    render(show(rows, ['b', 'c']));
    expect(screen.getByTestId('group-count').textContent).toBe('1 household in the group (1 not shown here)');
    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { changed: 2 } }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'All shown' }));
    expect(sent(0).input).toEqual({ householdIds: ['b', 'c'], inGroup: true });
    await waitFor(() => expect(screen.getByTestId('group-count').textContent).toBe('3 households in the group (1 not shown here)'));
  });

  it('marking as sent names who changes, who is already sent and who has no link, and sends the whole group', async () => {
    render(show(ROWS.map((r) => ({ ...r, inGroup: true }))));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as sent: the 3 households in the group' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'Mark 1 household as sent?' })).toBeTruthy();
    expect(within(sheet).getByText('The Babbages')).toBeTruthy();
    expect(within(sheet).getByText('Already sent').nextElementSibling?.textContent).toBe('1 household');
    expect(within(sheet).getByText('Skipped: no link yet').nextElementSibling?.textContent).toBe('The Lovelaces. Make their links first.');

    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { sent: true, changed: 1, already: 1, noLink: ['The Lovelaces'] } }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mark 1 household as sent' }));
    expect(await screen.findByText('1 household marked as sent.')).toBeTruthy();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/capabilities/admin_mark_households_sent');
    expect(sent(0).input).toEqual({ householdIds: ['a', 'b', 'c'], sent: true });
    expect(screen.getByTestId('mark-result').textContent).toContain('Skipped, with no link yet: The Lovelaces.');
  });

  it('with nobody to mark, the sheet says why and offers no button that would do nothing', () => {
    render(show([home('a', 'The Lovelaces', { inGroup: true })]));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as sent: the 1 household in the group' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'Nobody to mark as sent' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mark as sent' }));
    expect(within(sheet).getByText('Nobody in the group has a link that is not already sent. Make links first.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marking as not sent says what it takes away and asks for a tick before its red button does anything', async () => {
    render(show(ROWS.map((r) => ({ ...r, inGroup: true }))));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as not sent: the 3 households in the group' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'Mark 1 household as not sent?' })).toBeTruthy();
    expect(within(sheet).getByText(/can no longer sign in with Google or Facebook by name/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mark 1 household as not sent' }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByLabelText('Yes, mark 1 household as not sent'));
    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { sent: false, changed: 1, already: 1, noLink: ['The Lovelaces'] } }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mark 1 household as not sent' }));
    expect(await screen.findByText('1 household marked as not sent.')).toBeTruthy();
    expect(sent(0).input).toEqual({ householdIds: ['a', 'b', 'c'], sent: false });
  });

  it('emptying the group can be undone, and leaves focus somewhere', async () => {
    render(show(ROWS.map((r) => ({ ...r, inGroup: true }))));
    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { changed: 3 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Empty the group' }));
    expect(sent(0).input).toEqual({ householdIds: ['a', 'b', 'c'], inGroup: false });
    expect(await screen.findByText(/The group is empty: 3 households taken out\./)).toBeTruthy();
    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { changed: 3 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Put them back' }));
    expect(sent(1).input).toEqual({ householdIds: ['a', 'b', 'c'], inGroup: true });
    await waitFor(() => expect(screen.getByTestId('group-count').textContent).toBe('3 households in the group'));
  });

  it('makes links only for the households with none, shows them once, and keeps them through the refresh and nowhere else', async () => {
    const rows = ROWS.map((r) => ({ ...r, inGroup: true }));
    const { rerender } = render(show(rows));
    fireEvent.click(screen.getByRole('button', { name: 'Make links for the 3 households in the group' }));
    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Continue' }));
    expect(await within(sheet).findByText('A link for 1 household')).toBeTruthy();
    expect(within(sheet).getByText('2 households that already have a link')).toBeTruthy();

    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { links: [{ householdId: 'a', householdName: 'The Lovelaces', url: 'https://example.test/i/BULKTOKEN', tokenPrefix: 'BULK', expiresAt: '2027-11-01T00:00:00.000Z' }], hadLink: 0 } }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make 1 link' }));
    expect(await screen.findByText('https://example.test/i/BULKTOKEN')).toBeTruthy();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/capabilities/admin_issue_invitations');
    expect(sent(0).input).toEqual({ householdIds: ['a'], eventKeys: ['ceremony', 'reception'], plusOneAllowance: 0, childrenAllowance: 0 });
    expect(screen.getByTestId('issued-links').textContent).toContain('None is marked as sent.');

    // What the refresh brings back: the household now has a link. The new link is still on screen.
    rerender(show(rows.map((r) => (r.id === 'a' ? { ...r, link: 'active' as const } : r))));
    expect(screen.getByText('https://example.test/i/BULKTOKEN')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    await waitFor(() => expect(screen.queryByText('https://example.test/i/BULKTOKEN')).toBeNull());
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('BULKTOKEN');
  });
});
