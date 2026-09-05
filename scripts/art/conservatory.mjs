// Conservatory theme — procedural botanical art. Deterministic, license-free,
// theme colours only (src/themes/conservatory/DESIGN.md). No external refs.
// Contract: export generate() → [{ file, svg, alt, width, height }]

const C = {
  ink: '#2A4430', moss: '#4F6338', leafDeep: '#3F5F33', leaf: '#7E9C5F', mossWash: '#DFE5CF',
  pollen: '#D4B24A', sky: '#D4E4EC', skyInk: '#2B4A5A', creme: '#F4EEDF', ivory: '#FBF8F1',
  kraft: '#E4D6BA', kraftDeep: '#C9B48C', soil: '#6E5637', outline: '#C8C1AC',
};

// mulberry32 — small deterministic PRNG so every run yields identical files
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f = (n, d = 1) => Number(n.toFixed(d));
const svg = (w, h, title, body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t"${extra}>\n<title id="t">${title}</title>\n${body}\n</svg>`;

// A leaf: two curves meeting at the tip, plus a midrib. Local coords: base at (0,0), tip at (len,0).
function leaf(len, wid, fill = C.leaf, stroke = C.leafDeep, sw = 1.25, opacity = 0.85) {
  const d = `M0 0 Q${f(len * 0.45)} ${f(-wid)} ${len} 0 Q${f(len * 0.45)} ${f(wid)} 0 0Z`;
  return `<path d="${d}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/><path d="M1 0 L${f(len * 0.82)} 0" stroke="${stroke}" stroke-width="${f(sw * 0.7)}" fill="none"/>`;
}

// 1. leaf-border — repeating vine tile (period 240px, 5 repeats)
function leafBorder() {
  const W = 1200, H = 80, P = 240;
  let out = `<g fill="none" stroke="${C.leafDeep}" stroke-width="1.5" stroke-linecap="round">`;
  for (let i = 0; i < W / P; i++) {
    const x = i * P;
    out += `<path d="M${x} 44 C${x + 60} 18, ${x + 90} 70, ${x + 150} 40 S${x + 210} 22, ${x + P} 44"/>`;
  }
  out += '</g>';
  const r = rng(17);
  const leaves = [
    [22, 40, -48], [58, 30, -10], [96, 56, 36], [128, 50, -142], [166, 38, -28], [196, 34, 26], [222, 42, 150],
  ];
  for (let i = 0; i < W / P; i++) {
    for (const [lx, ly, rot] of leaves) {
      const len = 26 + f(r() * 8), wid = 7 + f(r() * 3);
      out += `<g transform="translate(${i * P + lx} ${ly}) rotate(${rot})">${leaf(len, wid)}</g>`;
    }
    // pollen berries at two nodes per period
    out += `<circle cx="${i * P + 78}" cy="46" r="2.6" fill="${C.pollen}"/><circle cx="${i * P + 184}" cy="34" r="2.2" fill="${C.pollen}"/>`;
  }
  return { file: 'leaf-border.svg', width: W, height: H, alt: 'Repeating botanical line-art border: a waving vine with alternating leaves and a few pollen-gold berries.', svg: svg(W, H, 'Leaf border', out, ' preserveAspectRatio="xMinYMid slice"') };
}

// 2. fern-divider — a single frond growing from the left, curling at the tip
function fernDivider() {
  const W = 480, H = 48;
  let out = `<path d="M4 30 C120 26, 260 22, 400 24 C430 25, 452 20, 462 12 C468 7, 462 3, 458 8" fill="none" stroke="${C.leafDeep}" stroke-width="1.5" stroke-linecap="round"/>`;
  const r = rng(29);
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const x = 18 + t * 408;
    const y = 30 - t * 6.5;
    const len = 14 * (1 - t * 0.78) + 3;
    const wid = 3.6 * (1 - t * 0.6) + 0.8;
    const up = i % 2 === 0;
    const ang = up ? -62 + t * 18 : 62 - t * 18;
    const jitter = f((r() - 0.5) * 3);
    out += `<g transform="translate(${f(x + jitter)} ${f(y)}) rotate(${f(ang)})">${leaf(len, wid, C.leaf, C.leafDeep, 1, 0.75)}</g>`;
  }
  return { file: 'fern-divider.svg', width: W, height: H, alt: 'A single fern frond drawn in line art, growing from the left and curling at the tip; used as a section divider.', svg: svg(W, H, 'Fern divider', out) };
}

// 3. moss-cluster — organic dotted cluster, three sizes
function mossCluster(size, seed, name) {
  const r = rng(seed);
  const cx = size / 2, cy = size / 2;
  const cols = [C.moss, C.leaf, C.leafDeep, C.leaf, C.moss];
  let out = `<ellipse cx="${cx}" cy="${cy}" rx="${f(size * 0.42)}" ry="${f(size * 0.34)}" fill="${C.mossWash}" transform="rotate(-12 ${cx} ${cy})"/>`;
  const n = Math.round(size * 1.1);
  for (let i = 0; i < n; i++) {
    // rejection-sampled inside a soft ellipse, denser toward centre
    const u = r(), v = r();
    const rad = Math.sqrt(u) * 0.46 * size;
    const th = v * Math.PI * 2;
    const x = cx + Math.cos(th) * rad, y = cy + Math.sin(th) * rad * 0.8 + (r() - 0.5) * size * 0.06;
    const dr = 0.8 + r() * (size / 48) * (1 - rad / size);
    out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(dr)}" fill="${cols[i % cols.length]}" fill-opacity="${f(0.55 + r() * 0.45, 2)}"/>`;
  }
  return { file: `moss-cluster-${name}.svg`, width: size, height: size, alt: `An organic cluster of moss-green dots (${name}), denser at the centre; decorative.`, svg: svg(size, size, `Moss cluster (${name})`, out) };
}

// 4. tendril-corner — a spiral tendril from the top-left corner with two curls and two small leaves
function tendrilCorner() {
  const S = 200;
  const spiral = (cx, cy, rot, turns = 1.6, a = 2.2) => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * turns * Math.PI * 2;
      const rr = a * Math.exp(0.28 * t);
      pts.push(`${f(cx + Math.cos(t + rot) * rr)} ${f(cy + Math.sin(t + rot) * rr)}`);
    }
    return `M${pts.reverse().join(' L')}`;
  };
  let out = `<g fill="none" stroke="${C.leafDeep}" stroke-width="1.5" stroke-linecap="round">`;
  out += `<path d="M2 2 C40 30, 70 40, 110 60 C140 75, 150 95, 152 120"/>`;
  out += `<path d="${spiral(150, 148, Math.PI * 1.1)}"/>`;
  out += `<path d="M60 34 C80 22, 104 26, 118 40"/>`;
  out += `<path d="${spiral(126, 42, Math.PI * 0.4, 1.4, 1.8)}"/>`;
  out += '</g>';
  out += `<g transform="translate(40 26) rotate(-30)">${leaf(24, 7)}</g><g transform="translate(96 54) rotate(40)">${leaf(20, 6)}</g>`;
  out += `<circle cx="150" cy="148" r="2.4" fill="${C.pollen}"/>`;
  return { file: 'tendril-corner.svg', width: S, height: S, alt: 'A climbing tendril in line art, spiralling out of the top-left corner with two small leaves; decorative corner ornament.', svg: svg(S, S, 'Tendril corner', out) };
}

// 5. specimen-tag — pressed-specimen label card with placeholder text
function specimenTag() {
  const W = 320, H = 140;
  const body = `
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="2" fill="${C.kraft}" stroke="${C.kraftDeep}" stroke-width="1"/>
<rect x="9" y="9" width="${W - 18}" height="${H - 18}" fill="none" stroke="${C.kraftDeep}" stroke-width="0.75" stroke-dasharray="1 3"/>
<circle cx="24" cy="24" r="4.5" fill="${C.ivory}" stroke="${C.kraftDeep}" stroke-width="1"/>
<path d="M24 24 C 4 18, -2 6, -8 -2" fill="none" stroke="${C.pollen}" stroke-width="1.5" stroke-linecap="round"/>
<text x="42" y="30" font-family="Spectral, Georgia, serif" font-size="10.5" letter-spacing="1.4" fill="${C.soil}">SPECIMEN</text>
<text x="42" y="66" font-family="Cardo, 'Times New Roman', serif" font-style="italic" font-size="22" fill="${C.soil}">TODO(Tyler &amp; Sara)</text>
<line x1="42" y1="76" x2="120" y2="76" stroke="${C.kraftDeep}" stroke-width="2"/>
<text x="42" y="100" font-family="Spectral, Georgia, serif" font-size="12.5" fill="${C.ink}">Chicago · 07 · 17 · 27</text>
<text x="42" y="118" font-family="Spectral, Georgia, serif" font-size="11" fill="${C.soil}">collected by TODO(Tyler &amp; Sara)</text>
<g transform="translate(268 96) rotate(-38)">${leaf(34, 9, C.leaf, C.leafDeep, 1.1, 0.6)}</g>`;
  return { file: 'specimen-tag.svg', width: W, height: H, alt: 'A kraft-paper specimen label with a pollen-gold thread through its hole, an italic placeholder plant name reading TODO(Tyler & Sara), the line "Chicago · 07 · 17 · 27", and a small pressed leaf.', svg: svg(W, H, 'Specimen tag', body) };
}

// 6. sky-wash — soft light-blue to creme wash, SVG gradients only
function skyWash() {
  const W = 1440, H = 640;
  const body = `
<defs>
  <radialGradient id="g1" cx="0.82" cy="0.08" r="0.9">
    <stop offset="0" stop-color="${C.sky}"/>
    <stop offset="0.55" stop-color="${C.sky}" stop-opacity="0.55"/>
    <stop offset="1" stop-color="${C.creme}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.creme}" stop-opacity="0"/>
    <stop offset="1" stop-color="${C.creme}"/>
  </linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="${C.creme}"/>
<rect width="${W}" height="${H}" fill="url(#g1)"/>
<rect width="${W}" height="${H}" fill="url(#g2)"/>`;
  return { file: 'sky-wash.svg', width: W, height: H, alt: 'A soft light-blue sky wash fading into creme paper; decorative background.', svg: svg(W, H, 'Sky wash', body, ' preserveAspectRatio="xMidYMin slice"') };
}

// 7. pressed-flower — three stylized bloom silhouettes
function pressedFlowerA() { // five-petal bloom on a stem with two leaves
  const S = 220;
  let out = `<path d="M110 214 C112 170, 118 140, 112 96" fill="none" stroke="${C.leafDeep}" stroke-width="1.75" stroke-linecap="round"/>`;
  out += `<g transform="translate(113 160) rotate(-150)">${leaf(40, 11)}</g><g transform="translate(115 190) rotate(30)">${leaf(34, 10)}</g>`;
  for (let i = 0; i < 5; i++) {
    const a = i * 72 - 90;
    out += `<g transform="translate(112 74) rotate(${a})"><path d="M0 0 C14 -14, 34 -18, 44 -4 C50 4, 44 16, 30 18 C16 20, 6 12, 0 0Z" fill="${C.mossWash}" stroke="${C.ink}" stroke-width="1.25" stroke-linejoin="round"/><path d="M4 2 L32 4" stroke="${C.ink}" stroke-width="0.6"/></g>`;
  }
  out += `<circle cx="112" cy="74" r="7" fill="${C.pollen}" stroke="${C.soil}" stroke-width="1"/>`;
  const r = rng(5);
  for (let i = 0; i < 9; i++) { const a = r() * Math.PI * 2, d = 9 + r() * 4; out += `<circle cx="${f(112 + Math.cos(a) * d)}" cy="${f(74 + Math.sin(a) * d)}" r="1.1" fill="${C.soil}"/>`; }
  return { file: 'pressed-flower-a.svg', width: S, height: S, alt: 'A pressed five-petal bloom on a stem with two leaves, drawn as a stylized silhouette with a pollen-gold centre.', svg: svg(S, S, 'Pressed flower A', out) };
}
function pressedFlowerB() { // umbel spray: radiating stalks ending in dotted florets
  const S = 220;
  const r = rng(11);
  let out = `<path d="M112 214 C110 170, 112 140, 110 104" fill="none" stroke="${C.leafDeep}" stroke-width="1.75" stroke-linecap="round"/>`;
  out += `<g transform="translate(111 176) rotate(-140)">${leaf(38, 8)}</g>`;
  const rays = 13;
  for (let i = 0; i < rays; i++) {
    const a = (-Math.PI * 0.95) + (i / (rays - 1)) * Math.PI * 0.9;
    const len = 44 + (r() - 0.5) * 14;
    const ex = 110 + Math.cos(a) * len, ey = 104 + Math.sin(a) * len;
    out += `<path d="M110 104 Q${f(110 + Math.cos(a) * len * 0.5)} ${f(104 + Math.sin(a) * len * 0.5 - 6)} ${f(ex)} ${f(ey)}" fill="none" stroke="${C.leafDeep}" stroke-width="1"/>`;
    for (let k = 0; k < 6; k++) {
      const b = r() * Math.PI * 2, d = 3 + r() * 6;
      out += `<circle cx="${f(ex + Math.cos(b) * d)}" cy="${f(ey + Math.sin(b) * d)}" r="${f(1.4 + r() * 1.2)}" fill="${C.ivory}" stroke="${C.ink}" stroke-width="0.7"/>`;
    }
  }
  return { file: 'pressed-flower-b.svg', width: S, height: S, alt: 'A pressed umbel spray: thin stalks radiating from one stem into clusters of tiny ivory florets.', svg: svg(S, S, 'Pressed flower B', out) };
}
function pressedFlowerC() { // bell spike: staggered bells along a curving stem
  const S = 220;
  let out = `<path d="M124 214 C120 170, 112 120, 96 30" fill="none" stroke="${C.leafDeep}" stroke-width="1.75" stroke-linecap="round"/>`;
  out += `<g transform="translate(122 196) rotate(-160)">${leaf(42, 11)}</g><g transform="translate(120 184) rotate(20)">${leaf(30, 9)}</g>`;
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const x = 120 - t * 22, y = 168 - t * 128;
    const side = i % 2 === 0 ? 1 : -1;
    const sc = 1 - t * 0.55;
    out += `<g transform="translate(${f(x)} ${f(y)}) scale(${f(sc, 2)}) rotate(${side * 35})"><path d="M0 0 C${side * 4} 6, ${side * 8} 16, ${side * 14} 26 L${side * 32} 26 C${side * 30} 14, ${side * 22} 6, ${side * 16} 0Z" fill="${C.sky}" stroke="${C.ink}" stroke-width="1.25" stroke-linejoin="round"/><path d="M${side * 14} 26 Q${side * 23} 31 ${side * 32} 26" fill="none" stroke="${C.ink}" stroke-width="1"/></g>`;
  }
  return { file: 'pressed-flower-c.svg', width: S, height: S, alt: 'A pressed bell-flower spike: eight bells staggered along a curving stem, smallest at the top.', svg: svg(S, S, 'Pressed flower C', out) };
}

export async function generate() {
  return [
    leafBorder(), fernDivider(),
    mossCluster(64, 101, 'sm'), mossCluster(128, 202, 'md'), mossCluster(240, 303, 'lg'),
    tendrilCorner(), specimenTag(), skyWash(),
    pressedFlowerA(), pressedFlowerB(), pressedFlowerC(),
  ];
}
