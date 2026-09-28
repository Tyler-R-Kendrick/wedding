import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectAnswer, type AnswerSlot } from '@/app/(admin)/admin/rsvp/_components/RsvpFlows';

/*
 * A row's "Correct" on /admin/rsvp: the record-an-answer flow with the guest and event already
 * chosen. Each row is a plain button until pressed (a screen of answers is not hundreds of dialogs),
 * then the one flow for that row opens on the answer on record, in the console's words.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

const slot = (eventId: string, eventName: string, status: AnswerSlot['status']): AnswerSlot => ({
  guestId: 'g1',
  displayName: 'Ada Lovelace',
  householdName: 'Lovelace',
  eventId,
  eventName,
  plusOnePolicy: 'none',
  status,
  mealLabel: null,
  mealStale: false,
  plusOne: null,
});

describe('correcting one RSVP answer', () => {
  it('renders no dialog until pressed, then opens on that guest and event', async () => {
    const slots = [slot('e1', 'Ceremony', 'declined'), slot('e2', 'Reception', null)];
    render(<CorrectAnswer slots={slots} menus={[]} pick={{ guestId: 'g1', eventId: 'e1' }} />);
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Correct Ada Lovelace’s answer for Ceremony' }));
    const sheet = await waitFor(() => screen.getByRole('dialog'));
    // Straight to the answer: the guest and event are not asked for again.
    expect(within(sheet).queryByLabelText('Guest')).toBeNull();
    expect(within(sheet).getByText('On record: not coming.')).toBeTruthy();
    expect(within(sheet).getByLabelText('Coming')).toBeTruthy();
    expect((within(sheet).getByLabelText('Not coming') as HTMLInputElement).checked).toBe(true);
  });
});
