import { describe, expect, it } from 'vitest';
import { peopleOfLine } from '@/domain/guests/sheet-people';

/**
 * Lines shaped like the couple's planning sheet, with invented names. Each case is one way the
 * sheet writes a household; what matters is who can then sign in under their own name.
 */
const line = (name: string, adults = 0, kids = 0, plusOnes = 0) => peopleOfLine({ name, adults, kids, plusOnes });
const names = (name: string, adults = 0, kids = 0, plusOnes = 0) => line(name, adults, kids, plusOnes).named.map((p) => `${p.firstName}|${p.lastName}${p.kind === 'plus_one' ? '|+1' : ''}`);

describe('the people on a line of the planning sheet', () => {
  it('a couple under one surname: both take it', () => {
    expect(names('Bram and Nora Fitzwilliam', 2)).toEqual(['Bram|Fitzwilliam', 'Nora|Fitzwilliam']);
    expect(names('Bram & Nora Fitzwilliam', 2)).toEqual(['Bram|Fitzwilliam', 'Nora|Fitzwilliam']);
    expect(names('Bram, Nora and Tess Fitzwilliam', 3)).toEqual(['Bram|Fitzwilliam', 'Nora|Fitzwilliam', 'Tess|Fitzwilliam']);
  });

  it('a couple under two surnames: each keeps their own', () => {
    expect(names("Alma Jarvik and Jody O'Brennan", 2)).toEqual(['Alma|Jarvik', "Jody|O'Brennan"]);
    expect(names('Barton Barnaby and Corin Le Marchand', 2)).toEqual(['Barton|Barnaby', 'Corin|Le Marchand']);
    expect(names('Anneke van der Berg and Luis De La Cruz', 2)).toEqual(['Anneke|van der Berg', 'Luis|De La Cruz']);
  });

  it('a partner listed by first name is not given a surname the sheet does not give', () => {
    const l = line('Neal Kendall and Tilly', 2);
    expect(l.named.map((p) => [p.firstName, p.lastName])).toEqual([['Neal', 'Kendall'], ['Tilly', '']]);
    // She is still someone who can sign in: by the surname of the person she is listed with.
    expect(l.notes).toEqual([]);
  });

  it('one name and more heads: the rest are counted, not named', () => {
    expect(line('Sara Fox', 2)).toMatchObject({ unnamedAdults: 1, unnamedPlusOnes: 0, named: [{ firstName: 'Sara', lastName: 'Fox', kind: 'adult' }] });
    expect(line('Charles', 4)).toMatchObject({ unnamedAdults: 3, notes: ['no_surname'] });
    expect(line('Nico Dragan', 1, 0, 1)).toMatchObject({ unnamedAdults: 0, unnamedPlusOnes: 1 });
    expect(line('Coralie Walken', 2, 2)).toMatchObject({ unnamedAdults: 1, kids: 2 });
  });

  it('a second name on a line with one adult and a plus-one is that plus-one', () => {
    expect(names('Alex Fitzwilliam and Janet Marlow', 1, 0, 1)).toEqual(['Alex|Fitzwilliam', 'Janet|Marlow|+1']);
    expect(line('Alex Fitzwilliam and Janet Marlow', 1, 0, 1)).toMatchObject({ unnamedAdults: 0, unnamedPlusOnes: 0, notes: [] });
    // With no head counts at all, everyone named is an adult.
    expect(names('Alex Fitzwilliam and Janet Marlow')).toEqual(['Alex|Fitzwilliam', 'Janet|Marlow']);
    // More names than heads: the names stand, and the line is flagged.
    expect(line('Alex Fitzwilliam and Janet Marlow', 1)).toMatchObject({ named: [{ kind: 'adult' }, { kind: 'adult' }], notes: ['more_names_than_heads'] });
  });

  it('lines with no surname at all name their people and say they cannot be found by name', () => {
    expect(line('Mick and Christa', 2)).toMatchObject({ named: [{ firstName: 'Mick', lastName: '' }, { firstName: 'Christa', lastName: '' }], notes: ['no_surname'] });
    expect(line('Edmund', 1, 0, 1)).toMatchObject({ named: [{ firstName: 'Edmund', lastName: '' }], unnamedPlusOnes: 1, notes: ['no_surname'] });
    expect(line('AJ', 2, 1)).toMatchObject({ named: [{ firstName: 'AJ', lastName: '' }], unnamedAdults: 1, kids: 1 });
    expect(line('Trey and D', 2).notes.sort()).toEqual(['initial_only', 'no_surname']);
  });

  it('a relation or a description is kept as written and flagged', () => {
    expect(line('Grandma Winslow', 1, 0, 1)).toMatchObject({ named: [{ firstName: 'Grandma', lastName: 'Winslow' }], notes: ['not_a_given_name'] });
    const l = line("Rico Tess's bro", 2, 2);
    expect(l.named).toEqual([{ firstName: 'Rico', lastName: '', kind: 'adult', alternateNames: [] }]);
    expect(l.notes.sort()).toEqual(['no_surname', 'not_a_given_name']);
    expect(l).toMatchObject({ unnamedAdults: 1, kids: 2 });
  });

  it('slips of the sheet: lower case, names run together, a surname cut short, stray spaces', () => {
    expect(names('eric bell', 1)).toEqual(['Eric|Bell']);
    expect(names('rob and lucy', 2)).toEqual(['Rob|', 'Lucy|']);
    expect(line('rob and lucy', 2).householdName).toBe('Rob and Lucy');
    expect(names('Stefan moss', 2)).toEqual(['Stefan|Moss']);
    expect(names('CoralieRosemont and Marcus Rowe', 2)).toEqual(['Coralie|Rosemont', 'Marcus|Rowe']);
    expect(names('Zeke Fitzwilliam and Lindy Fitz...', 2)).toEqual(['Zeke|Fitzwilliam', 'Lindy|Fitzwilliam']);
    expect(line('Zeke Fitzwilliam and Lindy Fitz...', 2).notes).toEqual([]);
    expect(line('Lindy Fitz…', 1)).toMatchObject({ named: [{ firstName: 'Lindy', lastName: 'Fitz' }], notes: ['cut_short'] });
    expect(names('  Charles  and   Regine   Barnaby ', 2)).toEqual(['Charles|Barnaby', 'Regine|Barnaby']);
    expect(names("Vito L'Amato", 2)).toEqual(["Vito|L'Amato"]);
    // A name with a capital inside is one name.
    expect(names('Ian McDonald and Rae DeAngelo', 2)).toEqual(['Ian|McDonald', 'Rae|DeAngelo']);
    expect(names('McDonald', 1)).toEqual(['McDonald|']);
  });

  it('a maiden name written on the line is kept as another name', () => {
    expect(line('Bram and Nora (Halloran) Fitzwilliam', 2).named).toEqual([
      { firstName: 'Bram', lastName: 'Fitzwilliam', kind: 'adult', alternateNames: [] },
      { firstName: 'Nora', lastName: 'Fitzwilliam', kind: 'adult', alternateNames: ['Nora Halloran'] },
    ]);
    expect(line('Nora Fitzwilliam (née Halloran)', 1).named[0]).toMatchObject({ firstName: 'Nora', lastName: 'Fitzwilliam', alternateNames: ['Nora Halloran'] });
    expect(line('Nora Fitzwilliam nee Halloran', 1).named[0]).toMatchObject({ firstName: 'Nora', lastName: 'Fitzwilliam', alternateNames: ['Nora Halloran'] });
    // A name that only contains the letters is not a maiden name.
    expect(names('Renee Tan', 1)).toEqual(['Renee|Tan']);
  });

  it('an empty or meaningless line names nobody and throws nothing', () => {
    for (const name of ['', '   ', 'and', '&', ',', '...']) expect(line(name, 2).named, JSON.stringify(name)).toEqual([]);
  });
});
