import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlanningSheet } from '@/app/(admin)/admin/guests/_components/PlanningSheet';
import type { GuestSheetView } from '@/capabilities/admin_guest_sheet';

/*
 * The planning sheet section on /admin/guests: totals, the head count by priority, every line of
 * the sheet, and an honest message (not an empty table) when the sheet cannot be read.
 */

const view: GuestSheetView = {
  rows: [
    { sheetRow: 2, name: 'Sample household A', adults: 2, kids: 0, plusOnes: 0, guestOf: 'Bride', group: 'Friend', priority: 1, saveTheDateSent: null, inviteSent: null, rsvp: null, table: null, menu: null },
    { sheetRow: 3, name: 'Sample household B', adults: 1, kids: 2, plusOnes: 1, guestOf: 'Groom', group: 'Work', priority: 2, saveTheDateSent: 'Yes', inviteSent: null, rsvp: null, table: '4', menu: null },
  ],
  totals: { households: 2, adults: 3, kids: 2, plusOnes: 1, people: 6, byPriority: [{ priority: 1, households: 1, people: 2, cumulativePeople: 2 }, { priority: 2, households: 1, people: 4, cumulativePeople: 6 }] },
  retrievedAt: '2026-11-08T18:00:00.000Z',
  ttlSeconds: 120,
  stale: false,
  sample: false,
  sheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit',
  withheldColumns: ['Address', 'Email'],
  missingColumns: [],
};

describe('PlanningSheet', () => {
  it('lists every line with its head counts and links to the sheet', () => {
    render(<PlanningSheet sheet={view} error={null} />);
    const table = screen.getByRole('table', { name: 'Every line of the sheet' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[2]!).getByRole('rowheader').textContent).toBe('Sample household B');
    expect(screen.getByRole('table', { name: 'Head count by priority' })).toBeTruthy();
    expect(screen.getByText('People', { selector: '.con-stat__label' }).parentElement?.textContent).toContain('6');
    expect(screen.getByRole('link', { name: /Open the sheet/ }).getAttribute('href')).toBe(view.sheetUrl);
    expect(screen.getByRole('link', { name: 'Refresh from the sheet' }).getAttribute('href')).toBe('/admin/guests?sheet=fresh#planning-sheet');
    expect(screen.getByText(/Not read from the sheet, on purpose: Address, Email/)).toBeTruthy();
  });

  it('says when it is showing the last good read', () => {
    render(<PlanningSheet sheet={{ ...view, stale: true }} error={null} />);
    expect(screen.getByText(/last good read/)).toBeTruthy();
  });

  it('shows the reason instead of a table when the sheet cannot be read', () => {
    render(<PlanningSheet sheet={null} error="The planning sheet isn't connected yet." />);
    expect(screen.getByText("The planning sheet isn't connected yet.")).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
