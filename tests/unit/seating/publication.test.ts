import { describe, expect, it } from 'vitest';
import { ID_PATTERN } from '@/contracts/ids';
import { fixtureId, seedId } from '@/db/seed/ids';
import { parseSeatingCsv } from '@/domain/seating/csv';
import { buildSnapshot, findGuestInSnapshot, snapshotDiffers } from '@/domain/seating/snapshot';

const tables = [
  { id: 'T1', name: 'Table 1', capacity: 8, floorPlanId: 'P', anchorId: 't1' },
  { id: 'T2', name: 'Table 2', capacity: 8, floorPlanId: null, anchorId: null },
];
const names = new Map([
  ['G1', 'Ada'],
  ['G2', 'Ben'],
  ['G3', 'Cleo'],
]);

describe('publication boundary', () => {
  it('returns nothing before publication or for unseated guests', () => {
    expect(findGuestInSnapshot(null, 'G1')).toBeNull();
    expect(findGuestInSnapshot(undefined, 'G1')).toBeNull();
    const snap = buildSnapshot(tables, [{ guestId: 'G1', tableId: 'T1', seatNumber: 2 }], names);
    expect(findGuestInSnapshot(snap, 'G2')).toBeNull();
  });
  it('reads only the snapshot: tablemates in seat order, orphans dropped', () => {
    const snap = buildSnapshot(
      tables,
      [
        { guestId: 'G1', tableId: 'T1', seatNumber: 2 },
        { guestId: 'G2', tableId: 'T1', seatNumber: 1 },
        { guestId: 'G3', tableId: 'T1', seatNumber: null },
        { guestId: 'GX', tableId: 'T-DELETED', seatNumber: 1 },
      ],
      names,
    );
    expect(snap.assignments).toHaveLength(3);
    expect(findGuestInSnapshot(snap, 'G1')).toEqual({ tableId: 'T1', tableName: 'Table 1', seatNumber: 2, floorPlanId: 'P', anchorId: 't1', tablemates: ['Ben', 'Cleo'] });
  });
  it('detects unpublished changes', () => {
    const a = buildSnapshot(tables, [{ guestId: 'G1', tableId: 'T1', seatNumber: 1 }], names);
    const b = buildSnapshot(tables, [{ guestId: 'G1', tableId: 'T1', seatNumber: 1 }], names);
    const c = buildSnapshot(tables, [{ guestId: 'G1', tableId: 'T2', seatNumber: 1 }], names);
    expect(snapshotDiffers(a, b)).toBe(false);
    expect(snapshotDiffers(a, c)).toBe(true);
    expect(snapshotDiffers(null, buildSnapshot([], [], names))).toBe(false);
    expect(snapshotDiffers(null, a)).toBe(true);
  });
});

describe('planner CSV import', () => {
  it('parses table,seat,guest with an optional header and quoted names', () => {
    const r = parseSeatingCsv('table,seat,guest\r\nTable 1,1,Ada Testhouse\n"Head, table",,"Ben ""B"" Testhouse"\n\n');
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, table: 'Table 1', seat: 1, guest: 'Ada Testhouse' },
      { line: 3, table: 'Head, table', seat: null, guest: 'Ben "B" Testhouse' },
    ]);
  });
  it('reports bad seats, missing columns, duplicates, and row caps by line', () => {
    const r = parseSeatingCsv('Table 1,x,Ada\nTable 1\nTable 2,3,Ben\nTable 3,4,ben');
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 4]);
    expect(parseSeatingCsv('a,1,b\nc,2,d', { maxRows: 1 }).errors[0]).toMatchObject({ line: 2 });
  });
});

describe('deterministic ids', () => {
  it('are ULID-shaped and stable', () => {
    expect(seedId('EVENTCEREMONY')).toMatch(ID_PATTERN);
    expect(fixtureId('GSTA1')).toBe(fixtureId('gsta1'));
    expect(fixtureId('GSTA1')).not.toBe(seedId('GSTA1'));
    expect(() => seedId('')).not.toThrow();
  });
});
