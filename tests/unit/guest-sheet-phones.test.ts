import { describe, expect, it } from 'vitest';
import { phoneOwnerIndexes, sheetSyncLines, splitPhones } from '@/domain/guests/sheet-sync';

describe('phone numbers on a sheet line', () => {
  it('splits a cell into numbers in order, keeping spaces inside a number', () => {
    expect(splitPhones('5551110000;5552220000')).toEqual(['5551110000', '5552220000']);
    expect(splitPhones('(555) 111-0000 / (555) 222-0000')).toEqual(['(555) 111-0000', '(555) 222-0000']);
    expect(splitPhones('5551110000.0')).toEqual(['5551110000']);
    expect(splitPhones('')).toEqual([]);
  });

  it('gives numbers to the people named, in order, and none beyond them', () => {
    expect(phoneOwnerIndexes(2, 2)).toEqual([0, 1]);
    expect(phoneOwnerIndexes(1, 2)).toEqual([0]);
    expect(phoneOwnerIndexes(2, 1)).toEqual([0, null]);
  });

  it('reads the Phone column beside the planning columns', () => {
    const text = ['Name\tTotal Adults\tGuest Of\tPhone', 'Bram and Nora Fitzwilliam\t2\tBride\t5551110000;5552220000', 'Ana Ruiz\t1\tGroom\t'].join('\n');
    const { lines } = sheetSyncLines(text);
    expect(lines[0]?.phones).toEqual(['5551110000', '5552220000']);
    expect(lines[1]?.phones).toBeUndefined();
  });
});
