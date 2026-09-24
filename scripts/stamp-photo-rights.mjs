#!/usr/bin/env node
// Embeds the couple's rights statement (src/content/photo-rights.json) in each of their photos as an
// XMP packet: the copyright notice, the owner, the usage terms, a link to /credits#rights, and the
// PLUS "data mining prohibited" flag that AI crawlers and dataset builders are asked to honour. The
// statement travels with the file wherever it is copied, which a robots.txt or a response header
// cannot do.
//
//   node scripts/stamp-photo-rights.mjs            # stamp every WebP in public/assets/photos/
//   node scripts/stamp-photo-rights.mjs --check    # exit 1 if any file lacks the current statement
//
// Lossless: the WebP container is edited, the image bitstream is copied byte for byte. The packet
// carries rights only (no camera, date or GPS fields); the renditions stay stripped of everything
// else (docs/ops/asset-licensing.md section 4). Re-running replaces the packet, so it is idempotent.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PHOTOS = join(root, 'public', 'assets', 'photos');
const rights = JSON.parse(await readFile(join(root, 'src', 'content', 'photo-rights.json'), 'utf8'));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function rightsXmp(r = rights) {
  const alt = (s) => `<rdf:Alt><rdf:li xml:lang="x-default">${esc(s)}</rdf:li></rdf:Alt>`;
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about=""',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"',
    ' xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"',
    ' xmlns:plus="http://ns.useplus.org/ldf/xmp/1.0/"',
    ` xmpRights:Marked="True" xmpRights:WebStatement="${esc(r.webStatement)}" photoshop:Credit="${esc(r.owner)}"`,
    ` plus:DataMining="${esc(r.dataMining)}">`,
    `<dc:rights>${alt(r.notice)}</dc:rights>`,
    `<xmpRights:Owner><rdf:Bag><rdf:li>${esc(r.owner)}</rdf:li></rdf:Bag></xmpRights:Owner>`,
    `<xmpRights:UsageTerms>${alt(r.usageTerms)}</xmpRights:UsageTerms>`,
    `<plus:OtherConstraints>${alt(r.usageTerms)}</plus:OtherConstraints>`,
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="r"?>',
  ].join('\n');
}

/** A WebP's chunks, in order: `{ id, data }`. */
function chunks(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') throw new Error('not a WebP');
  const out = [];
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    out.push({ id, data: buf.subarray(at + 8, at + 8 + size) });
    at += 8 + size + (size & 1);
  }
  return out;
}

function chunk(id, data) {
  const head = Buffer.alloc(8);
  head.write(id, 0, 'ascii');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/** The canvas size and alpha of a simple-format WebP, from its VP8 or VP8L bitstream header. */
function canvasOf(list) {
  const vp8 = list.find((c) => c.id === 'VP8 ');
  if (vp8) return { width: vp8.data.readUInt16LE(6) & 0x3fff, height: vp8.data.readUInt16LE(8) & 0x3fff, alpha: false };
  const vp8l = list.find((c) => c.id === 'VP8L');
  if (vp8l) {
    const bits = vp8l.data.readUInt32LE(1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: Boolean((bits >>> 28) & 1) };
  }
  throw new Error('no VP8/VP8L image data');
}

const XMP_FLAG = 0x04;
const ALPHA_FLAG = 0x10;

/** The same WebP with `xmp` as its only XMP packet, promoting a simple file to the extended format. */
export function withXmp(buf, xmp) {
  let list = chunks(buf).filter((c) => c.id !== 'XMP ');
  let vp8x = list.find((c) => c.id === 'VP8X');
  if (!vp8x) {
    const { width, height, alpha } = canvasOf(list);
    const data = Buffer.alloc(10);
    data[0] = alpha ? ALPHA_FLAG : 0;
    data.writeUIntLE(width - 1, 4, 3);
    data.writeUIntLE(height - 1, 7, 3);
    vp8x = { id: 'VP8X', data };
    list = [vp8x, ...list];
  } else {
    vp8x.data = Buffer.from(vp8x.data);
  }
  vp8x.data[0] |= XMP_FLAG;
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), ...list.map((c) => chunk(c.id, c.data)), chunk('XMP ', Buffer.from(xmp, 'utf8'))]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** The XMP packet a WebP carries, or null. */
export function xmpOf(buf) {
  const c = chunks(buf).find((x) => x.id === 'XMP ');
  return c ? c.data.toString('utf8') : null;
}

async function* webps(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* webps(p);
    else if (e.name.endsWith('.webp')) yield p;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const xmp = rightsXmp();
  let stale = 0;
  let count = 0;
  for await (const file of webps(PHOTOS)) {
    count++;
    const buf = await readFile(file);
    if (xmpOf(buf) === xmp) continue;
    stale++;
    if (check) console.error(`missing or stale rights statement: ${relative(root, file)}`);
    else await writeFile(file, withXmp(buf, xmp));
  }
  console.log(check ? `${count - stale}/${count} photos carry the rights statement` : `stamped ${stale} of ${count} photos`);
  if (check && stale) process.exit(1);
}
