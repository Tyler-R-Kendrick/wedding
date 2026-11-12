import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlanningSheet } from '@/app/(admin)/admin/guests/_components/PlanningSheet';
import type { GuestSheetView } from '@/capabilities/admin_guest_sheet';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/*
 * The planning sheet section on /admin/guests: when it was copied, totals, the head count by
 * priority, every line, the way to update it, and an honest message when there is no copy yet.
 */

const view: GuestSheetView = {
  copy: {
    rows: [
      { sheetRow: 2, name: 'Sample household A', adults: 2, kids: 0, plusOnes: 0, guestOf: 'Bride', group: 'Friend', priority: 1, saveTheDateSent: null, inviteSent: null, rsvp: null, table: null, menu: null },
      { sheetRow: 3, name: 'Sample household B', adults: 1, kids: 2, plusOnes: 1, guestOf: 'Groom', group: 'Work', priority: 2, saveTheDateSent: 'Yes', inviteSent: null, rsvp: null, table: '4', menu: null },
    ],
    totals: { households: 2, adults: 3, kids: 2, plusOnes: 1, people: 6, byPriority: [{ priority: 1, households: 1, people: 2, cumulativePeople: 2 }, { priority: 2, households: 1, people: 4, cumulativePeople: 6 }] },
    uploadedAt: '2026-11-12T18:00:00.000Z',
    source: 'Guests tab',
    withheldColumns: ['Address street', 'Email'],
    missingColumns: [],
  },
};

describe('PlanningSheet', () => {
  it('lists every line with its head counts, says when it was copied, and offers an update', () => {
    render(<PlanningSheet sheet={view} error={null} />);
    const table = screen.getByRole('table', { name: 'Every line of the sheet' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[2]!).getByRole('rowheader').textContent).toBe('Sample household B');
    expect(screen.getByRole('table', { name: 'Head count by priority' })).toBeTruthy();
    expect(screen.getByText('People', { selector: '.con-stat__label' }).parentElement?.textContent).toContain('6');
    expect(screen.getByText(/Copied from the sheet/).textContent).toContain('(Guests tab)');
    expect(screen.getByText(/Not copied from the sheet, on purpose: Address street, Email/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update from the sheet' })).toBeTruthy();
  });

  it('says there is no copy yet, and offers to add one', () => {
    render(<PlanningSheet sheet={{ copy: null }} error={null} />);
    expect(screen.getByText(/No copy of the planning sheet yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add the planning sheet' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the reason instead of a table when it cannot be read', () => {
    render(<PlanningSheet sheet={null} error="That could not be loaded." />);
    expect(screen.getByText('That could not be loaded.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
