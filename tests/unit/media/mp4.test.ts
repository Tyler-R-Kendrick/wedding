import { describe, expect, it } from 'vitest';
import { ascii, box, buildSyntheticMp4, bytesOf, listBoxes, mp4HasMetadataBoxes, probeMp4, stripMp4Metadata, walkMp4 } from '@/lib/media/mp4';
import { concat } from '../../helpers/media-fixtures';

describe('mp4 box walker', () => {
  it('walks, probes duration and dimensions', () => {
    const file = buildSyntheticMp4({ durationSeconds: 12.5, width: 1920, height: 1080, location: '+41.8789-087.6243/' });
    const walked = walkMp4(file);
    expect(walked.ok).toBe(true);
    if (walked.ok) expect(walked.boxes.map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
    expect(probeMp4(file)).toEqual({ brand: 'isom', durationSeconds: 12.5, width: 1920, height: 1080 });
    expect(probeMp4(buildSyntheticMp4({ brand: 'qt  ' }))?.brand).toBe('qt  ');
  });

  it('flags trailing data, missing ftyp/moov, and bad boxes', () => {
    expect(walkMp4(buildSyntheticMp4({ trailing: new Uint8Array(12) }))).toEqual({ ok: false, reason: 'trailing_data' });
    expect(walkMp4(concat(box('mdat', new Uint8Array(8)), box('moov', new Uint8Array(8))))).toEqual({ ok: false, reason: 'no_ftyp' });
    expect(walkMp4(concat(box('ftyp', ascii('isom'), bytesOf(0, 0, 0, 0)), box('mdat', new Uint8Array(8))))).toEqual({ ok: false, reason: 'no_moov' });
    expect(walkMp4(new Uint8Array(4))).toEqual({ ok: false, reason: 'too_short' });
    const broken = buildSyntheticMp4();
    broken[0] = 0xff; // absurd first box size
    expect(walkMp4(broken).ok).toBe(false);
    expect(listBoxes(new Uint8Array([0, 0, 0, 8, 0x01, 0x02, 0x03, 0x04]), 0, 8)).toBeNull(); // non-printable type
  });

  it('strips location/user-data boxes in place without changing size or structure', () => {
    const file = buildSyntheticMp4({ location: '+41.8789-087.6243/' });
    expect(mp4HasMetadataBoxes(file)).toBe(true);
    expect(Buffer.from(file).includes(Buffer.from('+41.8789-087.6243/'))).toBe(true);
    const { bytes, strippedBoxes } = stripMp4Metadata(file);
    expect(bytes.byteLength).toBe(file.byteLength);
    expect(strippedBoxes).toEqual(['udta']);
    expect(mp4HasMetadataBoxes(bytes)).toBe(false);
    expect(Buffer.from(bytes).includes(Buffer.from('+41.8789'))).toBe(false);
    expect(walkMp4(bytes).ok).toBe(true);
    expect(probeMp4(bytes)?.durationSeconds).toBe(3 === 3 ? probeMp4(file)?.durationSeconds : 0);
    // the input is untouched
    expect(mp4HasMetadataBoxes(file)).toBe(true);
  });

  it('also blanks top-level uuid (XMP) boxes and moov/meta', () => {
    const uuid = box('uuid', new Uint8Array(16).fill(0xaa), ascii('<x:xmpmeta>gps</x:xmpmeta>'));
    const base = buildSyntheticMp4();
    const withMeta = concat(base.subarray(0, base.byteLength), uuid);
    // walk fails on a plain concat? no: uuid is a valid top-level box
    expect(walkMp4(withMeta).ok).toBe(true);
    const out = stripMp4Metadata(withMeta);
    expect(out.strippedBoxes).toContain('uuid');
    expect(Buffer.from(out.bytes).includes(Buffer.from('xmpmeta'))).toBe(false);
  });
});
