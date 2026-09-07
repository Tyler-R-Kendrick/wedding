import { describe, expect, it } from 'vitest';
import { BURST_WINDOW_MS, computeBursts, representativeOf, type BurstCandidate } from '@/domain/mediaai/clusters';

const at = (seconds: number) => new Date(Date.UTC(2027, 6, 17, 22, 0, seconds));

const frame = (id: string, seconds: number, over: Partial<BurstCandidate> = {}): BurstCandidate =>
  ({
    id,
    capturedAt: at(seconds),
    cameraMake: 'Fixture',
    cameraModel: 'FixtureCam',
    ownerGuestId: 'GUESTA',
    vendor: null,
    dhash: 'ffffffffffffffff',
    qualitySignals: { sharpness: 10 },
    kind: 'image',
    ...over,
  }) as BurstCandidate;

describe('burst detection', () => {
  it('groups consecutive frames from one camera inside the window', () => {
    const bursts = computeBursts([frame('a', 0), frame('b', 1), frame('c', 2), frame('d', 60)]);
    expect(bursts).toHaveLength(1);
    expect(bursts[0]!.assetIds).toEqual(['a', 'b', 'c']);
    expect(bursts[0]!.startAt).toEqual(at(0));
    expect(bursts[0]!.endAt).toEqual(at(2));
    expect(bursts[0]!.key).toBe('a');
  });

  it('never merges different cameras or owners', () => {
    const mixed = [frame('a', 0), frame('b', 1, { ownerGuestId: 'GUESTB' }), frame('c', 2, { cameraModel: 'Other' })];
    expect(computeBursts(mixed)).toEqual([]);
  });

  it('splits when the gap exceeds the window or the frames stop looking alike', () => {
    const gap = computeBursts([frame('a', 0), frame('b', 1), frame('c', 2), frame('d', 2 + BURST_WINDOW_MS / 1000 + 1), frame('e', 12), frame('f', 13)]);
    expect(gap.map((g) => g.assetIds)).toEqual([['a', 'b', 'c']]);
    const unlike = computeBursts([frame('a', 0), frame('b', 1, { dhash: '0000000000000000' }), frame('c', 2, { dhash: '0000000000000000' })]);
    expect(unlike).toEqual([]);
  });

  it('ignores video and frames with no capture time', () => {
    expect(computeBursts([frame('a', 0, { kind: 'video' }), frame('b', 1, { kind: 'video' }), frame('c', 2, { kind: 'video' })])).toEqual([]);
    expect(computeBursts([frame('a', 0, { capturedAt: null }), frame('b', 1, { capturedAt: null }), frame('c', 2, { capturedAt: null })])).toEqual([]);
  });

  it('picks the sharpest frame as representative, never a subjective call', () => {
    const group = computeBursts([frame('a', 0), frame('b', 1, { qualitySignals: { sharpness: 99 } }), frame('c', 2)]);
    expect(group[0]!.representativeAssetId).toBe('b');
    expect(representativeOf([frame('x', 0, { qualitySignals: undefined }), frame('y', 1, { qualitySignals: { sharpness: 0 } })])).toBe('y');
  });

  it('needs at least three frames to call something a burst', () => {
    expect(computeBursts([frame('a', 0), frame('b', 1)])).toEqual([]);
  });
});
