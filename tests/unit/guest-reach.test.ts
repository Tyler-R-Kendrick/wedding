import { describe, expect, it } from 'vitest';
import { guestReach } from '@/domain/guests/reach';

const person = (id: string, householdId: string, over: Partial<{ email: string | null; phone: string | null; kind: 'adult' | 'child' | 'plus_one'; isMinor: boolean; isNamed: boolean }> = {}) => ({
  id,
  householdId,
  kind: 'adult' as 'adult' | 'child' | 'plus_one',
  isMinor: false,
  isNamed: true,
  email: null,
  phone: null,
  mergedIntoGuestId: null,
  ...over,
});

describe('households nobody can sign in for', () => {
  const households = [
    { id: 'a', name: 'Bram and Nora Fitzwilliam', sheetLabel: null },
    { id: 'b', name: 'Ana Ruiz', sheetLabel: null },
    { id: 'c', name: 'The Bakewells', sheetLabel: 'Tom Bakewell' },
    { id: 'd', name: 'Empty', sheetLabel: null },
    { id: 'e', name: 'Corwin Zarkov', sheetLabel: null },
  ];
  const people = [
    person('a1', 'a', { phone: '+15551110000' }),
    person('a2', 'a'),
    person('b1', 'b'),
    person('c1', 'c'),
    person('c2', 'c', { kind: 'child', isMinor: true, email: 'kid@example.com' }),
    person('e1', 'e'),
  ];
  const sheet = [
    { name: 'Ana Ruiz', priority: 3, guestOf: 'Groom' },
    { name: 'Tom Bakewell', priority: 1, guestOf: 'Bride' },
  ];

  it('flags a household only when no grown-up in it has an email or phone, most-wanted first', () => {
    const r = guestReach(households, people, new Set(['e1']), sheet);
    expect(r.unreachable.map((h) => h.name)).toEqual(['The Bakewells', 'Ana Ruiz']);
    expect(r.unreachable[0]).toMatchObject({ priority: 1, guestOf: 'Bride', people: 1 });
    expect(r.households).toBe(4);
    expect(r.peopleWithout).toBe(3);
  });

  it('a contact row counts as much as the email or phone column', () => {
    expect(guestReach(households, people, new Set(['b1', 'c1', 'e1'])).unreachable).toEqual([]);
  });
});
