import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteEventFlow, DeleteNoticeFlow, EventFlow, type EventSummary } from '@/app/(admin)/admin/events/_components/EventFlows';
import { IssueLinkFlow } from '@/app/(admin)/admin/invitations/_components/InvitationFlows';

/*
 * The events and invitations screens' own flows: deleting an event or a notice confirms first and
 * sends only the id; editing an event no longer asks for a "Position in lists" number (Up/Down on
 * the list does that); and the invitation link's events are the kit's check-box group, with a
 * household's name made possessive the way it reads ("The Kendricks’ link").
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
  push.mockReset();
  refresh.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.sessionStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

const answer = (body: unknown) => Promise.resolve({ json: () => Promise.resolve(body) } as Response);
const sentTo = (i = 0) => String(fetchMock.mock.calls[i]?.[0]);
const sentBody = (i = 0) => JSON.parse(String((fetchMock.mock.calls[i]?.[1] as RequestInit).body)) as { input: Record<string, unknown> };
const last = (name: string) => screen.getAllByRole('button', { name }).at(-1)!;

const brunch: EventSummary = {
  id: 'EVT1',
  name: 'Farewell brunch',
  description: null,
  dateIso: '2027-07-18',
  startsAt: null,
  endsAt: null,
  venueSpaceRef: null,
  dressCode: null,
  accessibilityNote: null,
  placeholder: true,
  rsvpRequired: true,
  sortOrder: 40,
  mealOptionsVersion: 2,
  mealOptions: [],
};

describe('events screen flows', () => {
  it('deletes an event only once it is confirmed, saying who loses their invitation', async () => {
    render(<DeleteEventFlow event={{ id: brunch.id, name: brunch.name, invitedCount: 3, mealOptionsVersion: 2 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Farewell brunch' }));
    expect(screen.getByText('The 3 guests invited to it are no longer invited. Its menu is deleted too.')).toBeTruthy();
    fireEvent.click(last('Delete Farewell brunch'));
    expect(await screen.findByText('Tick the box to confirm.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { deleted: true } }));
    fireEvent.click(screen.getByLabelText('Yes, delete Farewell brunch and its 3 invitations'));
    fireEvent.click(last('Delete Farewell brunch'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentTo()).toBe('/api/capabilities/admin_delete_event');
    expect(sentBody().input).toEqual({ id: 'EVT1' });
  });

  it('deletes a notice only once it is confirmed, and points at Hide for a while', async () => {
    render(<DeleteNoticeFlow notice={{ id: 'N1', title: 'Shuttle moved', active: true }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Shuttle moved' }));
    expect(screen.getByText(/use Hide instead/)).toBeTruthy();
    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { deleted: true, title: 'Shuttle moved' } }));
    fireEvent.click(screen.getByLabelText('Yes, delete Shuttle moved'));
    fireEvent.click(last('Delete Shuttle moved'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentTo()).toBe('/api/capabilities/admin_delete_notice');
    expect(sentBody().input).toEqual({ id: 'N1' });
  });

  it('edits an event without asking where it sits in lists, and sends no position', async () => {
    render(<EventFlow event={brunch} rooms={[]} label="Edit" variant="quiet" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Farewell brunch' }));
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByLabelText(/Dress code/);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByLabelText('Guests RSVP to this event');
    expect(screen.queryByLabelText(/Position in lists/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fetchMock.mockReturnValueOnce(answer({ ok: true, data: {} }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save event' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentTo()).toBe('/api/capabilities/admin_upsert_event');
    expect(sentBody().input).toMatchObject({ id: 'EVT1', name: 'Farewell brunch' });
    expect(sentBody().input).not.toHaveProperty('sortOrder');
  });
});

describe('invitation link flow', () => {
  it('ticks events in the kit’s check-box group and names a family’s link without a stray s', async () => {
    const events = [
      { value: 'ceremony', label: 'Ceremony' },
      { value: 'reception', label: 'Reception' },
      { value: 'farewell-brunch', label: 'Farewell brunch' },
    ];
    render(<IssueLinkFlow households={[{ value: 'HH1', label: 'The Kendricks' }]} events={events} defaultEvents={['ceremony', 'reception']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Make a link' }));
    fireEvent.change(screen.getByLabelText(/Household/), { target: { value: 'HH1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const group = await screen.findByRole('group', { name: 'Events' });
    expect(group.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    expect((screen.getByLabelText('Ceremony') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Farewell brunch'));
    fireEvent.click(screen.getByLabelText('Ceremony'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const submit = await screen.findByRole('button', { name: 'Make The Kendricks’ link' });
    fetchMock.mockReturnValueOnce(answer({ ok: true, data: { url: 'https://example.test/i/T', qrSvg: '<svg/>', invitation: { expiresAt: '2027-08-01T00:00:00.000Z' } } }));
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentTo()).toBe('/api/capabilities/admin_issue_invitation');
    expect(sentBody().input).toMatchObject({ householdId: 'HH1', eventKeys: ['reception', 'farewell-brunch'] });
    expect(await screen.findByText('The Kendricks’ link, shown only this once.')).toBeTruthy();
  });
});
