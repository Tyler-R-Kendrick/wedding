import { describe, expect, it } from 'vitest';
import { totalsOf } from '@/domain/guests/sheet-totals';
import { parseGuestSheet, parseGuestSheetText } from '@/domain/guests/sheet';

const HEADER = ['Family/Group Names', 'Total Adults', 'Total Kids', 'Plus 1', 'Guest Of', 'Group', 'Priority', 'Address', 'Email', 'Phone', 'Save the Date Sent', 'Invite Sent', 'RSVP', 'Table Number', 'Menu Choice', 'Dietary Restrictions', 'Notes'];

describe('parseGuestSheet', () => {
  it('reads the planning columns by header and never maps contact details, dietary needs or notes', () => {
    const parsed = parseGuestSheet([
      HEADER,
      ['Test household', '2', '1', '', 'Bride', 'Friend', '2', '1 Test St', 'test@example.test', '555-0100', 'Yes', 'No', 'Pending', '4', 'Fish', 'Peanuts', 'Secret note'],
    ]);
    expect(parsed.rows).toEqual([
      { sheetRow: 2, name: 'Test household', adults: 2, kids: 1, plusOnes: 0, guestOf: 'Bride', group: 'Friend', priority: 2, saveTheDateSent: 'Yes', inviteSent: 'No', rsvp: 'Pending', table: '4', menu: 'Fish' },
    ]);
    expect(JSON.stringify(parsed.rows)).not.toMatch(/Test St|example\.test|555-0100|Peanuts|Secret note/);
    expect(parsed.withheldColumns).toEqual(['Address', 'Email', 'Phone', 'Dietary Restrictions', 'Notes']);
    expect(parsed.missingColumns).toEqual([]);
  });

  it('follows the headers when columns move', () => {
    const parsed = parseGuestSheet([
      ['Priority', 'Guest Of', 'Family/Group Names', 'Total Adults'],
      ['1', 'Groom', 'Moved household', '3'],
    ]);
    expect(parsed.rows[0]).toMatchObject({ name: 'Moved household', adults: 3, guestOf: 'Groom', priority: 1 });
    expect(parsed.missingColumns).toContain('total kids');
  });

  it('takes the names from the first column when its header is not a name (the sheet reads "roung")', () => {
    const parsed = parseGuestSheet([
      ['roung', 'Total Adults', 'Group'],
      ['Household one', '2', 'Friend'],
    ]);
    expect(parsed.rows[0]).toMatchObject({ name: 'Household one', adults: 2, group: 'Friend' });
    expect(parsed.missingColumns).not.toContain('family group names');
  });

  it('stops at the first blank line, so the tallies kept below the list are not read as households', () => {
    const parsed = parseGuestSheet([HEADER, ['A', '1'], [], ['Total', '99']]);
    expect(parsed.rows.map((r) => r.name)).toEqual(['A']);
  });

  it('skips a line with nobody named on it', () => {
    const parsed = parseGuestSheet([HEADER, ['', '', '', '', 'Bride', 'Friend', '3'], ['B', '1']]);
    expect(parsed.rows.map((r) => r.name)).toEqual(['B']);
  });

  it('treats blanks and junk as zero heads and no priority, and a ticked plus-one as one', () => {
    const parsed = parseGuestSheet([HEADER, ['A', '', 'two', '?', '', '', 'high'], ['B', '1', '0', 'Yes'], ['C', '1', '0', '✓']]);
    expect(parsed.rows[0]).toMatchObject({ adults: 0, kids: 0, plusOnes: 0, priority: null });
    expect(parsed.rows.map((r) => r.plusOnes)).toEqual([0, 1, 1]);
  });
});

describe('parseGuestSheetText', () => {
  it('reads the tab as pasted out of Google Sheets (tab-separated), blank line and tallies included', () => {
    const text = ['roung\tTotal Adults\tTotal Kids\tPlus 1\tGuest Of\tGroup\tPriority\tEmail', "Ann and Bo O'Neil\t2\t\t\tBoth\tFriend\t1\tab@example.test", 'Cy\t1\t2\t1\tGroom\tWork\t2\tcy@example.test', '', '\t\t\t\t\t\t53760'].join('\r\n');
    const parsed = parseGuestSheetText(text);
    expect(parsed.rows.map((r) => [r.name, r.adults, r.kids, r.plusOnes])).toEqual([
      ["Ann and Bo O'Neil", 2, 0, 0],
      ['Cy', 1, 2, 1],
    ]);
    expect(parsed.withheldColumns).toEqual(['Email']);
  });

  it('reads a CSV export the same way, quoted commas and all', () => {
    const parsed = parseGuestSheetText('Family/Group Names,Total Adults,Notes\n"Smith, Jo and Al",2,"likes, commas"\n');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ name: 'Smith, Jo and Al', adults: 2 });
  });
});

describe('totalsOf', () => {
  it('counts heads and keeps a running total by priority', () => {
    const { rows } = parseGuestSheet([HEADER, ['A', '2', '', '', '', '', '1'], ['B', '1', '2', '1', '', '', '2'], ['C', '2', '', '', '', '', '']]);
    const t = totalsOf(rows);
    expect(t).toMatchObject({ households: 3, adults: 5, kids: 2, plusOnes: 1, people: 8 });
    expect(t.byPriority).toEqual([
      { priority: 1, households: 1, people: 2, cumulativePeople: 2 },
      { priority: 2, households: 1, people: 4, cumulativePeople: 6 },
    ]);
  });
});
