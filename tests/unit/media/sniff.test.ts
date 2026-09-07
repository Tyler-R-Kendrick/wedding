import { describe, expect, it } from 'vitest';
import { findDangerousSignature, jpegEnd, pngEnd, sniffMedia, webpEnd } from '@/lib/media/sniff';
import { ascii, box, bytesOf } from '@/lib/media/mp4';
import { ascii as a, concat, ELF_HEADER, jpegWithGps, PE_HEADER, plainJpeg, plainPng, plainWebp, syntheticMp4, ZIP_EOCD, ZIP_LOCAL_HEADER } from '../../helpers/media-fixtures';

describe('sniffMedia: allowlist by content, never by name', () => {
  it('accepts JPEG, PNG, WebP, MP4, MOV and HEIC by their bytes', async () => {
    expect(await sniffMedia(await plainJpeg())).toMatchObject({ ok: true, mime: 'image/jpeg', kind: 'image', ext: 'jpg', trailingBytes: 0 });
    expect(await sniffMedia(await plainPng())).toMatchObject({ ok: true, mime: 'image/png', ext: 'png' });
    expect(await sniffMedia(await plainWebp())).toMatchObject({ ok: true, mime: 'image/webp', ext: 'webp' });
    expect(await sniffMedia(syntheticMp4())).toMatchObject({ ok: true, mime: 'video/mp4', kind: 'video', ext: 'mp4' });
    expect(await sniffMedia(syntheticMp4({ brand: 'qt  ' }))).toMatchObject({ ok: true, mime: 'video/quicktime', ext: 'mov' });
    const heic = concat(box('ftyp', ascii('heic'), bytesOf(0, 0, 0, 0), ascii('mif1heic')), box('meta', new Uint8Array(24)), box('mdat', new Uint8Array(32)));
    expect(await sniffMedia(heic)).toMatchObject({ ok: true, mime: 'image/heic', kind: 'image' });
  });

  it('rejects renamed executables, archives, documents and markup whatever the declared name', async () => {
    for (const [name, bytes] of [
      ['exe', PE_HEADER],
      ['elf', ELF_HEADER],
      ['zip', concat(ZIP_LOCAL_HEADER, new Uint8Array(64), ZIP_EOCD)],
      ['gif', a('GIF89a' + '\x00'.repeat(40))],
      ['pdf', a('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj\n')],
      ['svg', a('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
      ['html', a('<!DOCTYPE html><html><body>hi</body></html>')],
      ['script', a('#!/bin/sh\nrm -rf /\n')],
      ['empty', new Uint8Array()],
    ] as const) {
      const r = await sniffMedia(bytes);
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(['unknown_type', 'disallowed_type', 'empty', 'polyglot']).toContain(r.reason);
    }
  });

  it('rejects polyglots: image bytes followed by an archive, executable or markup payload', async () => {
    const jpeg = await plainJpeg();
    const png = await plainPng();
    const webp = await plainWebp();
    for (const [name, payload] of [
      ['jpeg+zip', concat(jpeg, ZIP_LOCAL_HEADER, new Uint8Array(32), ZIP_EOCD)],
      ['jpeg+script', concat(jpeg, a('<script>alert(1)</script>'))],
      ['jpeg+php', concat(jpeg, a('<?php system($_GET["c"]); ?>'))],
      ['jpeg+html-mixed-case', concat(jpeg, a('<HtMl><body>x</body></HtMl>'))],
      ['jpeg+elf', concat(jpeg, ELF_HEADER)],
      ['png+zip', concat(png, ZIP_LOCAL_HEADER, ZIP_EOCD)],
      ['webp+svg', concat(webp, a('<svg onload="alert(1)"/>'))],
      ['mp4+zip-inside-structure', syntheticMp4({ trailing: concat(ZIP_LOCAL_HEADER, ZIP_EOCD) })],
    ] as const) {
      const r = await sniffMedia(payload);
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.reason, name).toBe('polyglot');
    }
  });

  it('rejects ISO-BMFF files with bytes outside the box structure or without moov', async () => {
    const trailing = await sniffMedia(syntheticMp4({ trailing: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) }));
    expect(trailing).toMatchObject({ ok: false, reason: 'polyglot' });
    const noMoov = concat(box('ftyp', ascii('isom'), bytesOf(0, 0, 2, 0), ascii('isom')), box('mdat', new Uint8Array(16)));
    expect(await sniffMedia(noMoov)).toMatchObject({ ok: false, reason: 'structure' });
  });

  it('tolerates benign trailing bytes (phone motion-photo style) but reports them', async () => {
    const jpeg = await plainJpeg();
    const r = await sniffMedia(concat(jpeg, new Uint8Array(200).fill(0x42)));
    expect(r).toMatchObject({ ok: true, mime: 'image/jpeg', trailingBytes: 200 });
  });

  it('accepts real EXIF/XMP-bearing JPEGs (XMP is not markup we ban)', async () => {
    expect(await sniffMedia(await jpegWithGps())).toMatchObject({ ok: true, mime: 'image/jpeg' });
  });

  it('exposes structural helpers', async () => {
    const jpeg = await plainJpeg();
    expect(jpegEnd(jpeg)).toBe(jpeg.byteLength);
    expect(jpegEnd(new Uint8Array([0xff, 0xd8, 0, 0]))).toBe(-1);
    const png = await plainPng();
    expect(pngEnd(png)).toBe(png.byteLength);
    expect(pngEnd(png.subarray(0, png.byteLength - 4))).toBe(-1);
    const webp = await plainWebp();
    expect(webpEnd(webp)).toBe(webp.byteLength);
    expect(findDangerousSignature(a('abc <SCRIPT>'))).toBe('script');
    expect(findDangerousSignature(a('plain text'))).toBeNull();
    expect(findDangerousSignature(concat(a('xx'), PE_HEADER))).toBeNull(); // MZ is only dangerous at offset 0
  });
});
