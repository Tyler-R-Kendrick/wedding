import { describe, expect, it } from 'vitest';
import { matchGuestsByName, namesMatch, normalizeNamePart } from '@/domain/identity/name-match';

describe('name-match', () => {
  it('normalizes accents, case, and punctuation', () => {
    expect(normalizeNamePart('  José-María  ')).toBe('jose maria');
    expect(normalizeNamePart("O'Brien")).toBe('obrien');
  });

  it('matches nicknames to formal invitation names', () => {
    expect(namesMatch({ givenName: 'Bill', familyName: 'Hayes' }, { firstName: 'William', lastName: 'Hayes' })).toBe(true);
    expect(namesMatch({ givenName: 'Liz', familyName: 'Chen' }, { firstName: 'Elizabeth', lastName: 'Chen' })).toBe(true);
  });

  it('matches alternate names on the guest record', () => {
    expect(
      namesMatch(
        { givenName: 'Kate', familyName: 'Nguyen' },
        { firstName: 'Katherine', lastName: 'Nguyen', alternateNames: ['Kate Nguyen'] },
      ),
    ).toBe(true);
  });

  it('flags ambiguous duplicate names', () => {
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

  it('ignores middle names and hyphenated surnames when tokens overlap', () => {
    expect(namesMatch({ name: 'Sarah Anne Fitzgerald-Kendrick' }, { firstName: 'Sarah', lastName: 'Fitzgerald' })).toBe(true);
  });
});
