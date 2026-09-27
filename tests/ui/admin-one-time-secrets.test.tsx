import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvitationList, type InvitationRowView } from '@/app/(admin)/admin/invitations/_components/InvitationList';
import { UploadCodesFlow } from '@/app/(admin)/admin/transport/_components/TransportFlows';
import { ImportGuestsFlow } from '@/app/(admin)/admin/guests/_components/GuestFlows';

/*
 * Two things the console shows once, or never: an invitation link (the token is not stored, so the
 * flow that made it is the only place it can be shown) and a pasted batch of ride codes (sealed on
 * save, never echoed). These pin that the invitations screen keeps the new link on screen through
 * the refresh that revokes the old one, and that the codes flow neither drafts nor echoes the codes.
 */

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

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
  refresh.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.sessionStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

const answer = (body: unknown) => Promise.resolve({ json: () => Promise.resolve(body) } as Response);

const row = (over: Partial<InvitationRowView> & Pick<InvitationRowView, 'id'>): InvitationRowView => ({
  householdName: 'The Lovelaces',
  tokenPrefix: 'abcd…',
  lifecycle: 'active',
  revokedReason: null,
  rotatedFromId: null,
  events: 'Ceremony, Reception',
  allowances: 'no plus-ones, no children',
  expires: 'Jan 01, 2027',
  claimed: null,
  ...over,
});

describe('invitation links', () => {
  it('keeps the replacement link on its Done panel after the refresh revokes the old one', async () => {
    const before = [row({ id: 'A' })];
    const { rerender } = render(<InvitationList rows={before} showRevoked={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Replace The Lovelaces’ invitation link' }));
    fireEvent.click(screen.getByLabelText('Yes, replace the link (the old one stops working)'));
    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { url: 'https://example.test/i/NEWTOKEN', qrSvg: '<svg/>', invitation: { id: 'B', expiresAt: '2027-02-01T00:00:00.000Z' } } }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace The Lovelaces’ link' }));
    expect(await screen.findByText('https://example.test/i/NEWTOKEN')).toBeTruthy();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/capabilities/admin_rotate_invitation');

    // What router.refresh() brings back: A replaced (hidden by default), B in its place.
    rerender(<InvitationList rows={[row({ id: 'B', tokenPrefix: 'wxyz…', rotatedFromId: 'A' }), row({ id: 'A', lifecycle: 'revoked', revokedReason: 'rotated' })]} showRevoked={false} />);
    expect(screen.getByText('https://example.test/i/NEWTOKEN')).toBeTruthy();
    expect(screen.getByTestId('issued-link').querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);

    // Closing it is the end of it: nothing about the link is kept on the device.
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    await waitFor(() => expect(screen.queryByText('https://example.test/i/NEWTOKEN')).toBeNull());
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('NEWTOKEN');
  });
});

describe('ride codes', () => {
  it('counts the codes, keeps no draft of them, and reports counts only', async () => {
    render(<UploadCodesFlow defaultProgram="reception-ride-home" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add ride codes' }));
    fireEvent.change(screen.getByLabelText('Codes, one per line'), { target: { value: 'SECRET-ONE\nSECRET-TWO\nSECRET-ONE\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('2 codes')).toBeTruthy();
    expect(window.sessionStorage.length).toBe(0);

    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { program: 'reception-ride-home', added: 2, duplicates: 0, rejected: 0 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Add the codes' }));
    expect(await screen.findByText(/2 codes added to reception-ride-home/)).toBeTruthy();
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as { input: { codes: string[] } };
    expect(body.input.codes).toEqual(['SECRET-ONE', 'SECRET-TWO']);
    expect(document.body.textContent).not.toContain('SECRET-ONE');
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('guest list import', () => {
  const CSV = 'household,first_name,last_name,email\nLovelace,Ada,Lovelace,ada@example.test\n';

  it('dry-runs the pasted list with its own idempotency key, and never keeps the list on the device', async () => {
    render(<ImportGuestsFlow />);
    fireEvent.click(screen.getByRole('button', { name: 'Import a list' }));
    fireEvent.change(screen.getByLabelText('CSV'), { target: { value: CSV } });
    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { dryRun: true, householdsCreated: 1, guestsCreated: 1, guestsUpdated: 0, skipped: 0, issues: [] } }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/capabilities/admin_import_guests_csv');
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as { input: { dryRun: boolean }; idempotencyKey?: string };
    expect(body.input.dryRun).toBe(true);
    expect(body.idempotencyKey, 'an idempotent action refuses a call without a key').toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(await screen.findByRole('heading', { name: 'Check what will change' })).toBeTruthy();
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('ada@example.test');
  });

  it('says a list too long for one request should be split, before sending it', async () => {
    render(<ImportGuestsFlow />);
    fireEvent.click(screen.getByRole('button', { name: 'Import a list' }));
    fireEvent.change(screen.getByLabelText('CSV'), { target: { value: CSV + 'Lovelace,Ada,Lovelace,ada@example.test\n'.repeat(8000) } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/too long to send in one go/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
