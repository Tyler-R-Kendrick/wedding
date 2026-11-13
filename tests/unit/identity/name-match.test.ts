import { describe, expect, it } from 'vitest';
import { matchGuestsByName, namesMatch, normalizeNamePart, parseProviderProfile } from '@/domain/identity/name-match';

describe('name-match', () => {
  it('S-04: diacritics José / Jose normalize for matching', () => {
    expect(normalizeNamePart('  José-María  ')).toBe('jose maria');
    expect(normalizeNamePart("O'Brien")).toBe('obrien');
  });

  it('S-03: nickname Mike matches guest Michael', () => {
    expect(namesMatch({ givenName: 'Bill', familyName: 'Hayes' }, { firstName: 'William', lastName: 'Hayes' })).toBe(true);
    expect(namesMatch({ givenName: 'Liz', familyName: 'Chen' }, { firstName: 'Elizabeth', lastName: 'Chen' })).toBe(true);
  });

  it('S-06: alternate_names on the guest record match', () => {
    expect(
      namesMatch(
        { givenName: 'Kate', familyName: 'Nguyen' },
        { firstName: 'Katherine', lastName: 'Nguyen', alternateNames: ['Kate Nguyen'] },
      ),
    ).toBe(true);
  });

  it('S-13: two guests with the same name are ambiguous', () => {
    const guests = [
      { id: '1', firstName: 'Michael', lastName: 'Smith', alternateNames: [] as string[] },
      { id: '2', firstName: 'Michael', lastName: 'Smith', alternateNames: [] as string[] },
    ];
    const r = matchGuestsByName({ givenName: 'Mike', familyName: 'Smith' }, guests);
    expect(r.confidence).toBe('ambiguous');
    expect(r.matches).toHaveLength(2);
  });

  it('returns one confident match', () => {
    const guests = [
      { id: '1', firstName: 'Ana', lastName: 'Ruiz', alternateNames: [] as string[] },
      { id: '2', firstName: 'Dev', lastName: 'Fixture', alternateNames: [] as string[] },
    ];
    const r = matchGuestsByName({ givenName: 'Ana', familyName: 'Ruiz' }, guests);
    expect(r.confidence).toBe('one');
    expect(r.matches[0]?.id).toBe('1');
  });

  it('S-02 S-05: middle dropped and hyphenated surnames still match', () => {
    expect(namesMatch({ name: 'Sarah Anne Fitzgerald-Kendrick' }, { firstName: 'Sarah', lastName: 'Fitzgerald' })).toBe(true);
    expect(namesMatch({ givenName: 'Michelle', familyName: 'Sunder' }, { firstName: 'Michelle Elaine', lastName: 'Sunder' })).toBe(true);
  });

  it('S-07: single-word provider name does not false-match a distinct family', () => {
    expect(namesMatch({ givenName: 'Madonna' }, { firstName: 'Madonna', lastName: 'Ruiz' })).toBe(false);
  });

  it('S-08: titles Dr. / Jr. are stripped in normalization', () => {
    expect(normalizeNamePart('Dr. Ana Ruiz Jr.')).toBe('ana ruiz');
    expect(namesMatch({ name: 'Dr. Ana Ruiz Jr.' }, { firstName: 'Ana', lastName: 'Ruiz' })).toBe(true);
  });

  it('S-09: emoji in provider name is stripped or fails to match', () => {
    expect(normalizeNamePart('Ana 🎉 Ruiz')).toBe('ana ruiz');
    expect(namesMatch({ name: 'Ana 🎉 Ruiz' }, { firstName: 'Ana', lastName: 'Ruiz' })).toBe(true);
  });

  it('S-10: non-Latin script only matches when guest record aligns', () => {
    expect(namesMatch({ givenName: '张伟', familyName: 'Lee' }, { firstName: 'Wei', lastName: 'Lee' })).toBe(false);
    expect(namesMatch({ givenName: 'Wei', familyName: 'Lee' }, { firstName: 'Wei', lastName: 'Lee' })).toBe(true);
  });

  it('S-11: reversed first/last in provider `name` field is parsed', () => {
    const parsed = parseProviderProfile({ name: 'Sunder Michelle' });
    expect(parsed.family.length).toBeGreaterThan(0);
    expect(parsed.given.length).toBeGreaterThan(0);
  });

  it('S-12: provider handle without email path does not match without name overlap', () => {
    expect(namesMatch({ givenName: 'totally_unrelated_handle' }, { firstName: 'Ana', lastName: 'Ruiz' })).toBe(false);
  });

  describe('S-01 middle name matrix (Michelle Sunder)', () => {
    const guest = { firstName: 'Michelle', lastName: 'Sunder', alternateNames: [] as string[] };
    const guestMiddle = { firstName: 'Michelle Elaine', lastName: 'Sunder', alternateNames: [] as string[] };

    const profiles = [
      { givenName: 'Michelle', familyName: 'Sunder' },
      { name: 'Michelle Elaine Sunder' },
      { name: 'Michelle E. Sunder' },
    ] as const;

    for (const p of profiles) {
      it(`matches provider ${JSON.stringify(p)} to Michelle Sunder`, () => {
        expect(namesMatch(p, guest)).toBe(true);
      });
    }

    it('reverse: Michelle Sunder provider matches guest with middle on record', () => {
      expect(namesMatch({ givenName: 'Michelle', familyName: 'Sunder' }, guestMiddle)).toBe(true);
    });
  });

  it('S-14 fuzzy match allows single typo when one guest', () => {
    const guests = [{ id: '1', firstName: 'Michelle', lastName: 'Sunder', alternateNames: [] as string[] }];
    const r = matchGuestsByName({ givenName: 'Michele', familyName: 'Sunder' }, guests);
    expect(r.confidence).toBe('one');
  });

  it('S-15 fuzzy typo ambiguous with two similar guests', () => {
    const guests = [
      { id: '1', firstName: 'Michael', lastName: 'Smith', alternateNames: [] as string[] },
      { id: '2', firstName: 'Micheal', lastName: 'Smith', alternateNames: [] as string[] },
    ];
    const r = matchGuestsByName({ givenName: 'Michal', familyName: 'Smith' }, guests);
    expect(r.confidence).toBe('ambiguous');
  });
});
