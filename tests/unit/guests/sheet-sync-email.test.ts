import { describe, expect, it } from 'vitest';
import { emailOwner } from '@/domain/guests/sheet-sync';

/**
 * Whose address an email on a couple's line is. A verified email signs a guest in on its own, so an
 * address given to the wrong person signs in the wrong person: when in doubt it is nobody's.
 * Invented names throughout.
 */
const people = (...names: string[]) => names.map((n) => ({ firstName: n.split(' ')[0]!, lastName: n.split(' ').slice(1).join(' ') }));
const owner = (email: string, ...names: string[]) => emailOwner(email, people(...names))?.firstName ?? null;

describe('whose address an email on a line is', () => {
  it('a lone person’s line: theirs, whatever it says', () => {
    expect(owner('sunflower88@example.test', 'Edgar Marrow')).toBe('Edgar');
  });

  it('the person it names, as a word of its own or run into the surname', () => {
    expect(owner('neal.k@example.test', 'Neal Kendall', 'Tilly')).toBe('Neal');
    expect(owner('zeke_fitz22@example.test', 'Zeke Fitzwilliam', 'Lindy Fitzwilliam')).toBe('Zeke');
    expect(owner('nealkendall@example.test', 'Neal Kendall', 'Tilly Kendall')).toBe('Neal');
    expect(owner('tillyk@example.test', 'Neal Kendall', 'Tilly Kendall')).toBe('Tilly');
    expect(owner('jordan.smithe@example.test', 'Dan Smithe', 'Jordan Smithe')).toBe('Jordan');
  });

  it('an initial and the surname is the person with that initial', () => {
    expect(owner('b.zjordan@example.test', 'Dan Zjordan', 'Beth Zjordan')).toBe('Beth');
    expect(owner('rzhannigan@example.test', 'Ann Zhannigan', 'Rob Zhannigan')).toBe('Rob');
    expect(owner('bfitzwilliam@example.test', 'Bram Fitzwilliam', 'Nora Fitzwilliam')).toBe('Bram');
  });

  it('letters that only sit inside a longer word name nobody', () => {
    // "dan" is inside "zjordan" and "ann" inside "zhannigan": neither is that person's address.
    expect(owner('zjordanfamily@example.test', 'Dan Zjordan', 'Beth Zjordan')).toBeNull();
    expect(owner('the.zhannigans@example.test', 'Ann Zhannigan', 'Rob Zhannigan')).toBeNull();
    expect(owner('daniela@example.test', 'Dan Zjordan', 'Beth Zjordan')).toBeNull();
  });

  it('an address that names both, or neither, or two people with one initial, is nobody’s', () => {
    expect(owner('bram.and.nora@example.test', 'Bram Fitzwilliam', 'Nora Fitzwilliam')).toBeNull();
    expect(owner('sunflower88@example.test', 'Bram Fitzwilliam', 'Nora Fitzwilliam')).toBeNull();
    expect(owner('bfitzwilliam@example.test', 'Bram Fitzwilliam', 'Bea Fitzwilliam')).toBeNull();
    expect(owner('', 'Bram Fitzwilliam', 'Nora Fitzwilliam')).toBeNull();
  });

  it('a line that counts a head it does not name: only an address that names the person it does', () => {
    const tom = people('Tom Mailzill');
    // "Mr and Mrs Tom Mailzill", two adults: the address may be his wife's.
    expect(emailOwner('mary.mailzill@example.test', tom, 1)).toBeNull();
    expect(emailOwner('sunflower88@example.test', tom, 1)).toBeNull();
    expect(emailOwner('tom.mailzill@example.test', tom, 1)?.firstName).toBe('Tom');
    expect(emailOwner('edgar.i.marrow22@example.test', people('Edgar'), 1)?.firstName).toBe('Edgar');
  });

  it('two people whose given names are forms of one another: an address under the shared name is nobody’s', () => {
    expect(owner('chris.millwick@example.test', 'Chris Millwick', 'Christine Millwick')).toBeNull();
    expect(owner('chrism@example.test', 'Chris Millwick', 'Christine Millwick')).toBeNull();
    expect(owner('samc@example.test', 'Sam Cartwell', 'Samantha Cartwell')).toBeNull();
    expect(owner('alexh@example.test', 'Alex Hartwell', 'Alexandra Hartwell')).toBeNull();
    expect(owner('bill.rowan@example.test', 'Bill Rowan', 'William Rowan')).toBeNull();
  });
});
