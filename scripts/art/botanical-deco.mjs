// Botanical–Deco ornament: original fine-line Deco art for the approved design. License-free by
// construction (generated here). Decoration only: the skyline is schematic, not a surveyed drawing,
// and the monogram is Sara and Tyler's own S|T — never the Chicago Athletic Association's mark.
//
// The flowers are NOT generated here. The approved design asks for substantial, painterly ivory
// blossoms and olive foliage; line-art stems would be exactly the "tiny generic line icons" the
// handoff rejects. Those come from public-domain botanical plates (scripts/botanical-deco-media.mjs).

const GOLD = '#B39463';
const GOLD_DEEP = '#8C6D43';
const IVORY = '#F8F5EE';

const f = (n) => Number(n.toFixed(1));

/**
 * A schematic Chicago skyline in one hairline path, read left to right as from the lake. The
 * silhouettes are the recognisable ones — the stepped Willis Tower with its two masts, the setbacks
 * and spire of Trump, the tapering Hancock with its antennas, the plain slab of Aon, the pointed
 * crown of Two Prudential — at heights that feel right, not measured ones.
 */
function skyline(width = 1200, height = 150) {
  const base = height - 6;
  const parts = [];
  const rect = (x, w, h) => parts.push(`M${f(x)} ${base}V${f(base - h)}H${f(x + w)}V${base}`);
  const mast = (x, h, m) => parts.push(`M${f(x)} ${f(base - h)}V${f(base - h - m)}`);
  // Low-rise run-in on the left.
  let x = 8;
  for (const [w, h] of [[26, 18], [18, 30], [30, 22], [22, 40], [16, 28], [28, 46], [20, 34]]) {
    rect(x, w, h);
    x += w + 3;
  }
  // Willis Tower: bundled stepped tubes, two masts.
  const wx = x + 10;
  rect(wx, 44, 96);
  rect(wx + 8, 30, 112);
  rect(wx + 15, 16, 124);
  mast(wx + 18, 124, 20);
  mast(wx + 28, 124, 16);
  x = wx + 54;
  for (const [w, h] of [[22, 58], [18, 70], [26, 52], [14, 64]]) {
    rect(x, w, h);
    x += w + 3;
  }
  // Two Prudential: slab with a pointed crown.
  const px = x + 6;
  rect(px, 24, 88);
  parts.push(`M${f(px)} ${f(base - 88)}L${f(px + 12)} ${f(base - 104)}L${f(px + 24)} ${f(base - 88)}`);
  mast(px + 12, 104, 10);
  x = px + 30;
  // Aon Center: a plain tall slab.
  rect(x, 30, 112);
  x += 36;
  for (const [w, h] of [[20, 66], [26, 80], [16, 58]]) {
    rect(x, w, h);
    x += w + 3;
  }
  // Trump International: three setbacks and a spire.
  const tx = x + 8;
  rect(tx, 38, 84);
  rect(tx + 5, 28, 104);
  rect(tx + 10, 18, 120);
  mast(tx + 19, 120, 22);
  x = tx + 46;
  for (const [w, h] of [[18, 62], [24, 74], [20, 56], [16, 68]]) {
    rect(x, w, h);
    x += w + 3;
  }
  // 875 North Michigan (Hancock): a tapering tower with two antennas.
  const hx = x + 10;
  parts.push(`M${f(hx)} ${base}L${f(hx + 6)} ${f(base - 116)}H${f(hx + 30)}L${f(hx + 36)} ${base}`);
  parts.push(`M${f(hx + 3)} ${f(base - 58)}L${f(hx + 33)} ${f(base - 30)}M${f(hx + 33)} ${f(base - 58)}L${f(hx + 3)} ${f(base - 30)}`);
  mast(hx + 12, 116, 24);
  mast(hx + 24, 116, 24);
  x = hx + 44;
  // Run-out to the right.
  for (const [w, h] of [[24, 48], [18, 36], [30, 42], [20, 26], [26, 34], [16, 20], [30, 24], [22, 16]]) {
    if (x + w > width - 8) break;
    rect(x, w, h);
    x += w + 3;
  }
  // Trim the drawing to what was drawn, then run the shoreline under it all.
  width = Math.ceil(x + 6);
  parts.push(`M4 ${base + 2}H${width - 4}`);
  return {
    file: 'skyline-line.svg',
    width,
    height,
    alt: '',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false"><path d="${parts.join('')}" fill="none" stroke="${GOLD}" stroke-width="1" stroke-linejoin="miter" vector-effect="non-scaling-stroke"/></svg>`,
  };
}

/** A stepped Deco corner: three nested right angles. Rotated in CSS for the other corners. */
function corner() {
  const s = 64;
  const d = [0, 7, 14].map((o) => `M${o} ${s}V${o}H${s}`).join('');
  return {
    file: 'deco-corner.svg',
    width: s,
    height: s,
    alt: '',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${s + 2} ${s + 2}" width="${s}" height="${s}" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="${GOLD}" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`,
  };
}

/** A short rule with a lozenge at its centre, for under headings. */
function rule() {
  const w = 120;
  return {
    file: 'deco-rule.svg',
    width: w,
    height: 12,
    alt: '',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 12" width="${w}" height="12" aria-hidden="true" focusable="false"><path d="M0 6H52M68 6H${w}" stroke="${GOLD}" stroke-width="1"/><path d="M60 1.5L64.5 6L60 10.5L55.5 6Z" fill="none" stroke="${GOLD}" stroke-width="1"/></svg>`,
  };
}

/** The favicon / touch icon: S|T in fine gold on ivory, framed by a stepped line. */
function icon() {
  return {
    file: 'monogram-icon.svg',
    width: 64,
    height: 64,
    alt: 'Sara and Tyler',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><title>Sara and Tyler</title><rect width="64" height="64" fill="${IVORY}"/><path d="M6 6H58V58H6Z" fill="none" stroke="${GOLD}" stroke-width="1.2"/><path d="M32 13V51" stroke="${GOLD}" stroke-width="1.2"/><text x="19" y="42" font-family="'Bodoni Moda','Times New Roman',serif" font-size="26" fill="${GOLD_DEEP}" text-anchor="middle">S</text><text x="45" y="42" font-family="'Bodoni Moda','Times New Roman',serif" font-size="26" fill="${GOLD_DEEP}" text-anchor="middle">T</text></svg>`,
  };
}

export function generate() {
  return [skyline(), corner(), rule(), icon()];
}
