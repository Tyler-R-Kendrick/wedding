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

  it('a title is not a name, and a word that stands for someone names nobody', () => {
    expect(names('Dr. Ana Ruizdale', 1)).toEqual(['Ana|Ruizdale']);
    // "Mr and Mrs Tom Bakewell": Tom, and a head counted. Never a guest called "Mrs Tom".
    expect(names('Mr and Mrs Tom Bakewell', 2)).toEqual(['Tom|Bakewell']);
    expect(line('Mr and Mrs Tom Bakewell', 2).unnamedAdults).toBe(1);
    for (const written of ['Ana Ruizdale and Guest', 'Ana Ruizdale + 1', 'Ana Ruizdale & family', 'Ana Ruizdale and plus one']) expect(names(written, 2), written).toEqual(['Ana|Ruizdale']);
    expect(line('Ana Ruizdale + 1', 1, 0, 1)).toMatchObject({ unnamedAdults: 0, unnamedPlusOnes: 1 });
  });

  it('a family’s name alone names nobody, and says so', () => {
    for (const written of ['The Bakewell Family', 'Bakewell family', 'The Bakewells']) {
      const l = line(written, 2);
      expect(l.named, written).toEqual([]);
      expect(l).toMatchObject({ unnamedAdults: 2, notes: ['not_a_given_name'] });
    }
    expect(line('The Bakewell Family', 2).householdName).toBe('The Bakewell Family');
    // With a person in front of it, that person is named.
    expect(names('Tom Bakewell family', 3)).toEqual(['Tom|Bakewell']);
  });

  it('a father and son keep what tells them apart', () => {
    expect(names('Corwin Zarkov Sr.', 1)).toEqual(['Corwin|Zarkov Sr.']);
    expect(names('Corwin Zarkov Jr', 1)).toEqual(['Corwin|Zarkov Jr']);
    expect(names('Corwin Zarkov III and Dana Zarkov', 2)).toEqual(['Corwin|Zarkov III', 'Dana|Zarkov']);
  });

  it('a surname that is also a particle is a surname', () => {
    expect(names('Linh Le', 1)).toEqual(['Linh|Le']);
    expect(names('Minh Van and Thu Van', 2)).toEqual(['Minh|Van', 'Thu|Van']);
  });

  it('a surname that is also an ordinary word, or a single letter, is a surname', () => {
    expect(names('Tom House', 1)).toEqual(['Tom|House']);
    expect(names('Amanda Crew', 1)).toEqual(['Amanda|Crew']);
    expect(names('Bram and Nora House', 2)).toEqual(['Bram|House', 'Nora|House']);
    expect(names('Mike S and Sarah T', 2)).toEqual(['Mike|S', 'Sarah|T']);
    expect(names('Jin Park and So', 2)).toEqual(['Jin|Park', 'So|']);
  });

  it('a plus-one written against a name is counted, however it is written', () => {
    for (const written of ['Ana Ruizdale +1', 'Ana Ruizdale plus one', 'Ana Ruizdale + 1', 'Ana Ruizdale plus-one']) {
      expect(names(written, 1, 0, 1), written).toEqual(['Ana|Ruizdale']);
      expect(line(written, 1, 0, 1), written).toMatchObject({ unnamedAdults: 0, unnamedPlusOnes: 1 });
    }
  });

  it('titles with only a surname between them name nobody', () => {
    const l = line('Dr. and Mrs. Bakewell', 2);
    expect(l.named).toEqual([]);
    expect(l).toMatchObject({ unnamedAdults: 2, notes: ['not_a_given_name'] });
  });

  it('brackets are never split into people, and are a name only where a maiden name is written', () => {
    // A business, a role, a note: nobody's name, and nobody to sign in as.
    expect(line('Ana Ruizdale (Petal & Twine)', 1).named).toEqual([{ firstName: 'Ana', lastName: 'Ruizdale', kind: 'adult', alternateNames: [] }]);
    expect(line('Tom Bakewell (boss)', 1).named[0]).toMatchObject({ firstName: 'Tom', lastName: 'Bakewell', alternateNames: [] });
    expect(line("Rico (Tess's brother) and Tess Bakewell", 2).named.map((p) => [p.firstName, p.alternateNames])).toEqual([['Rico', []], ['Tess', []]]);
    // Between the given name and the surname, or said to be one.
    expect(line('Nora (Halloran) Fitzwilliam', 1).named[0]!.alternateNames).toEqual(['Nora Halloran']);
    expect(line('Nora Fitzwilliam (born Halloran)', 1).named[0]!.alternateNames).toEqual(['Nora Halloran']);
  });

  it('the sheet’s own tally labels name nobody', () => {
    for (const written of ['Total', 'Totals', 'Subtotal', 'Count']) expect(line(written, 120).named, written).toEqual([]);
  });
});
