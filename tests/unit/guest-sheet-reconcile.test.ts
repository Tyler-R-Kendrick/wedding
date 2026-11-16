import { describe, expect, it } from 'vitest';
import type { GuestSheetRow } from '@/domain/guests/sheet';
import { diffSheetCopies, reconcileSheet, sheetKey, type SiteHousehold } from '@/domain/guests/sheet-reconcile';

const line = (sheetRow: number, name: string, adults = 2, kids = 0, plusOnes = 0): GuestSheetRow => ({ sheetRow, name, adults, kids, plusOnes, guestOf: null, group: null, priority: null, saveTheDateSent: null, inviteSent: null, rsvp: null, table: null, menu: null });
const home = (id: string, name: string, adults = 2, kids = 0, plusOnes = 0, sheetLabel: string | null = null): SiteHousehold => ({ id, name, adults, kids, plusOnes, sheetLabel });

describe('the planning sheet beside the guest list', () => {
  it('reads names loosely: case, punctuation, "&" and filler words do not count', () => {
    expect(sheetKey('The Fitzgerald Family')).toBe('fitzgerald');
    expect(sheetKey('Ana Ruiz & Guest')).toBe('ana ruiz');
    expect(sheetKey('  troy AND d. ')).toBe('troy d');
    expect(sheetKey('José Núñez')).toBe('jose nunez');
  });

  it('never reads two different names as the same empty name', () => {
    // Letters of any script are letters, and a name that is only filler keeps its words.
    expect(sheetKey('Иванов')).toBe('иванов');
    expect(sheetKey('Иванов')).not.toBe(sheetKey('Петров'));
    expect(sheetKey('Guests')).toBe('guests');
    expect(sheetKey('The Family')).toBe('the family');
    const sync = reconcileSheet([line(2, 'Иванов'), line(3, 'Guests')], [home('h1', 'Петров', 2, 0, 0, 'Петров')]);
    expect(sync.matched).toEqual([]);
    expect(diffSheetCopies([line(2, 'Иванов')], [line(2, 'Петров')])).toMatchObject({ added: [{ label: 'Петров' }], removed: [{ label: 'Иванов' }] });
  });

  it('matches a line to a household by name, and says when the grown-ups or children differ', () => {
    const sync = reconcileSheet(
      [line(2, 'Fitzgerald', 2, 1), line(3, 'Ana Ruiz & Guest', 1, 0, 1), line(4, 'Lee', 2, 0, 0)],
      [home('h1', 'The Fitzgerald Family', 2, 0), home('h2', 'Ana Ruiz', 1, 0, 1), home('h3', 'Lee', 1, 0, 1)],
    );
    expect(sync.matched.map((m) => [m.label, m.household.id, m.how, m.differs])).toEqual([
      ['Fitzgerald', 'h1', 'name', true],
      ['Ana Ruiz & Guest', 'h2', 'name', false],
      // Two adults on the sheet; one named adult and one unnamed plus-one here, which is how the
      // sync keeps a head the line counts and does not name. The same two grown-ups.
      ['Lee', 'h3', 'name', false],
    ]);
    expect(sync.summary).toMatchObject({ lines: 3, matched: 3, differing: 1, onlyOnSheet: 0, onlyOnSite: 0, sheetPeople: 7, sitePeople: 6 });
    // A plus-one the sheet counts and the site lacks is a head missing here.
    expect(reconcileSheet([line(2, 'Ana Ruiz', 1, 0, 1)], [home('h2', 'Ana Ruiz', 1, 0, 0)]).matched[0]!.differs).toBe(true);
  });

  it('a saved link wins over a name, and survives either side being renamed', () => {
    const households = [home('h1', 'The Fitzgeralds', 2, 0, 0, 'Mom/Dad Fitz'), home('h2', 'Mom Dad Fitz')];
    const sync = reconcileSheet([line(2, 'Mom/Dad Fitz')], households);
    expect(sync.matched).toHaveLength(1);
    expect(sync.matched[0]).toMatchObject({ household: { id: 'h1' }, how: 'linked' });
    // The household that only shares the name is left over, not matched twice.
    expect(sync.onlyOnSite.map((h) => h.id)).toEqual(['h2']);
  });

  it('lists what is on one side only, and suggests a household when a name is close', () => {
    const sync = reconcileSheet([line(2, 'Troy and D'), line(3, 'Work friends'), line(4, 'Nowak cousins')], [home('h1', 'Troy Dawson'), home('h2', 'The Okafor Family')]);
    expect(sync.matched).toEqual([]);
    expect(sync.onlyOnSheet.map((l) => [l.label, l.suggestion?.id ?? null])).toEqual([
      ['Troy and D', 'h1'],
      ['Work friends', null],
      ['Nowak cousins', null],
    ]);
    expect(sync.onlyOnSite.map((h) => h.name)).toEqual(['Troy Dawson', 'The Okafor Family']);
  });

  it('never gives one household to two lines', () => {
    const sync = reconcileSheet([line(2, 'Fitzgerald'), line(3, 'The Fitzgerald Family')], [home('h1', 'Fitzgerald')]);
    expect(sync.matched).toHaveLength(1);
    expect(sync.onlyOnSheet.map((l) => l.sheetRow)).toEqual([3]);
  });

  it('says what a new copy changed against the last one', () => {
    const before = [line(2, 'Fitzgerald', 2, 0), line(3, 'Ruiz', 1), line(4, 'Solo', 1)];
    const after = [line(2, 'Fitzgerald', 2, 1), line(3, 'Solo', 1), line(4, 'Okafor', 4, 2)];
    expect(diffSheetCopies(before, after)).toEqual({
      added: [{ label: 'Okafor', people: 6 }],
      removed: [{ label: 'Ruiz', people: 1 }],
      changed: [{ label: 'Fitzgerald', before: { adults: 2, kids: 0, plusOnes: 0 }, after: { adults: 2, kids: 1, plusOnes: 0 } }],
    });
    // A row that only moved is not a change.
    expect(diffSheetCopies(before, [...before].reverse())).toEqual({ added: [], removed: [], changed: [] });
  });
});
