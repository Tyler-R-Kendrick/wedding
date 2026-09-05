// Gilded Hour — procedural Art Deco ornament for Sara + Tyler's wedding site.
// License-free by construction: every asset below is drawn from code, with no
// randomness (the marble filter uses a fixed feTurbulence seed, so it is a pure
// function of this file). Colors are the Gilded Hour DESIGN.md tokens only.
//   node scripts/generate-art.mjs gilded-hour
// Contract: export generate() → Array<{ file, svg, alt, width, height }>.

const C = {
  ink: '#1C1B18',        // colors.primary
  marble: '#F8F6F1',     // colors.neutral
  surface: '#FDFCFA',    // colors.surface
  creme: '#EDE5D6',      // colors.neutral-variant
  outline: '#D8CFBF',    // colors.outline
  gold: '#C9A648',       // colors.gold (ornament only)
  goldWash: '#F3EAD0',   // colors.gold-wash
  bronze: '#7A5A16',     // colors.tertiary (text-safe gold)
  lake: '#2E5B7B',       // colors.secondary
  lakeWash: '#CFE0EB',   // colors.lake-wash
  moss: '#4F5F3F',       // colors.moss
};

const FONT_DISPLAY = "Cinzel, Georgia, serif";
const FONT_NUMERAL = "'Big Shoulders Display', 'Josefin Sans', sans-serif";

const f = (n) => Number(n.toFixed(2));

function svg({ w, h, title, desc, body, defs = '' }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t d">
<title id="t">${title}</title>
<desc id="d">${desc}</desc>
${defs ? `<defs>${defs}</defs>\n` : ''}${body}
</svg>`;
}

// Rectangle whose four corners are cut into two ziggurat steps of size `s`.
function steppedRectPath(x, y, w, h, s) {
  const r = x + w, b = y + h;
  return [
    `M${x + 2 * s} ${y}`, `H${r - 2 * s}`, `v${s}`, `h${s}`, `v${s}`, `h${s}`,          // top-right corner
    `V${b - 2 * s}`, `h${-s}`, `v${s}`, `h${-s}`, `v${s}`,                                 // bottom-right corner
    `H${x + 2 * s}`, `v${-s}`, `h${-s}`, `v${-s}`, `h${-s}`,                               // bottom-left corner
    `V${y + 2 * s}`, `h${s}`, `v${-s}`, `h${s}`, `Z`,                                      // top-left corner
  ].join(' ');
}

// Regular octagon path with corner cut `c`.
function octagonPath(x, y, w, h, c) {
  const r = x + w, b = y + h;
  return `M${x + c} ${y} H${r - c} L${r} ${y + c} V${b - c} L${r - c} ${b} H${x + c} L${x} ${b - c} V${y + c} Z`;
}

// 1. Sunburst hero: hairline rays fanning from a stepped half-sun at the bottom centre.
function sunburstHero() {
  const w = 1440, h = 720, cx = 720, cy = 720;
  const rays = [];
  const N = 48; // rays across 180°
  for (let i = 0; i <= N; i++) {
    const a = Math.PI + (i / N) * Math.PI;           // π → 2π (upper half)
    const dev = Math.abs(i / N - 0.5) * 2;           // 0 at the vertical axis, 1 at the horizon
    const r0 = 150;
    const len = i % 2 === 0 ? 640 : 470;
    const r1 = r0 + len * (1 - 0.35 * dev);
    const op = f(0.28 + 0.6 * (1 - dev));
    const wdt = i % 6 === 0 ? 2 : 1;
    rays.push(`<line x1="${f(cx + r0 * Math.cos(a))}" y1="${f(cy + r0 * Math.sin(a))}" x2="${f(cx + r1 * Math.cos(a))}" y2="${f(cy + r1 * Math.sin(a))}" stroke-width="${wdt}" opacity="${op}"/>`);
  }
  // Every sixth gap carries a translucent wedge — the "gold leaf" behind the hairlines.
  const wedges = [];
  for (let i = 3; i < N; i += 6) {
    const a0 = Math.PI + ((i - 0.5) / N) * Math.PI, a1 = Math.PI + ((i + 0.5) / N) * Math.PI;
    const r0 = 150, r1 = 560;
    wedges.push(`<path d="M${f(cx + r0 * Math.cos(a0))} ${f(cy + r0 * Math.sin(a0))} L${f(cx + r1 * Math.cos(a0))} ${f(cy + r1 * Math.sin(a0))} L${f(cx + r1 * Math.cos(a1))} ${f(cy + r1 * Math.sin(a1))} L${f(cx + r0 * Math.cos(a1))} ${f(cy + r0 * Math.sin(a1))} Z" fill="${C.gold}" opacity="0.10"/>`);
  }
  // Concentric arcs (double hairline) and a stepped half-sun.
  const arc = (r, sw, op) => `<path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="${C.gold}" stroke-width="${sw}" opacity="${op}"/>`;
  const steps = [[0, 120, 14], [14, 96, 12], [26, 72, 10], [36, 48, 8]]
    .map(([dy, sw2, sh]) => `<rect x="${cx - sw2 / 2}" y="${cy - dy - sh}" width="${sw2}" height="${sh}" fill="${C.gold}"/>`).join('');
  const body = `<g stroke="${C.gold}" stroke-linecap="butt">${rays.join('')}</g>${wedges.join('')}${arc(128, 2, 0.9)}${arc(138, 1, 0.9)}${arc(150, 1, 0.5)}${steps}`;
  return { file: 'sunburst-hero.svg', width: w, height: h, alt: 'Gold Art Deco sunburst: hairline rays fanning upward from a stepped half-sun at the bottom centre, on a transparent ground.', svg: svg({ w, h, title: 'Gilded Hour sunburst', desc: 'Decorative gold sunburst with stepped half-sun; hero background ornament.', body }) };
}

// 2. Chevron divider: paired hairlines, small diamonds, and a nested chevron cluster at centre.
function chevronDivider() {
  const w = 1200, h = 40, my = 20;
  const chev = (cx, size, sw, color) => `<polyline points="${cx - size},${my + size / 2} ${cx},${my - size / 2} ${cx + size},${my + size / 2}" fill="none" stroke="${color}" stroke-width="${sw}"/>`;
  const diamond = (cx, s) => `<path d="M${cx} ${my - s} L${cx + s} ${my} L${cx} ${my + s} L${cx - s} ${my} Z" fill="${C.gold}"/>`;
  const body = [
    `<g stroke="${C.gold}" stroke-width="1"><line x1="0" y1="${my}" x2="536" y2="${my}"/><line x1="664" y1="${my}" x2="1200" y2="${my}"/>`,
    `<line x1="24" y1="${my - 5}" x2="24" y2="${my + 5}"/><line x1="1176" y1="${my - 5}" x2="1176" y2="${my + 5}"/></g>`,
    diamond(300, 4), diamond(900, 4),
    chev(600, 30, 1, C.gold), chev(600, 20, 1.5, C.gold), chev(600, 10, 2, C.bronze),
  ].join('');
  return { file: 'chevron-divider.svg', width: w, height: h, alt: 'Gold hairline section divider with a centred cluster of three nested chevrons and small diamonds.', svg: svg({ w, h, title: 'Chevron divider', desc: 'Section rule: gold hairlines meeting three nested chevrons at the centre.', body }) };
}

// 3. Stepped frame: a Deco photo frame with ziggurat corners; transparent interior.
function steppedFrame() {
  const w = 800, h = 1000, s = 24;
  const body = [
    `<path d="${steppedRectPath(6, 6, w - 12, h - 12, s)}" fill="none" stroke="${C.gold}" stroke-width="3"/>`,
    `<path d="${steppedRectPath(20, 20, w - 40, h - 40, s)}" fill="none" stroke="${C.gold}" stroke-width="1"/>`,
    // Four small stepped keystones at the midpoints of the long sides.
    `<path d="M${w / 2 - 22} 20 v8 h8 v8 h28 v-8 h8 v-8 Z" fill="${C.gold}"/>`,
    `<path d="M${w / 2 - 22} ${h - 20} v-8 h8 v-8 h28 v8 h8 v8 Z" fill="${C.gold}"/>`,
  ].join('');
  return { file: 'stepped-frame.svg', width: w, height: h, alt: 'Gold Art Deco photo frame with stepped corners: a heavy outer line and a hairline inner line, open in the middle for a photograph.', svg: svg({ w, h, title: 'Stepped frame', desc: 'Portrait photo frame with ziggurat corners; the interior is transparent.', body }) };
}

// 4. Corner bracket: one stepped bracket for the top-left; rotate with CSS for the others.
function cornerBracket() {
  const w = 160, h = 160;
  const body = [
    `<path d="M0 160 V0 H160" fill="none" stroke="${C.gold}" stroke-width="3"/>`,
    `<path d="M14 160 V14 H160" fill="none" stroke="${C.gold}" stroke-width="1"/>`,
    `<path d="M26 92 V26 H92 V38 H38 V92 Z" fill="${C.gold}" opacity="0.9"/>`,
    `<path d="M48 64 V48 H64 V64 Z" fill="${C.gold}"/>`,
  ].join('');
  return { file: 'corner-bracket.svg', width: w, height: h, alt: 'Gold stepped corner bracket for the top-left of a framed block.', svg: svg({ w, h, title: 'Corner bracket', desc: 'Top-left stepped corner ornament.', body }) };
}

// 5. Monogram frame: "S & T" inside a double octagon, with the 07 · 17 · 27 date motif.
function monogramFrame() {
  const w = 600, h = 600;
  const body = [
    `<path d="${octagonPath(10, 10, 580, 580, 96)}" fill="${C.surface}" stroke="${C.gold}" stroke-width="3"/>`,
    `<path d="${octagonPath(26, 26, 548, 548, 90)}" fill="none" stroke="${C.gold}" stroke-width="1"/>`,
    `<g stroke="${C.gold}" stroke-width="1"><line x1="150" y1="200" x2="450" y2="200"/><line x1="150" y1="206" x2="450" y2="206"/><line x1="150" y1="394" x2="450" y2="394"/><line x1="150" y1="400" x2="450" y2="400"/></g>`,
    `<polyline points="286,172 300,158 314,172" fill="none" stroke="${C.gold}" stroke-width="1.5"/>`,
    `<text x="300" y="332" text-anchor="middle" font-family="${FONT_DISPLAY}" font-size="112" font-weight="500" letter-spacing="0.06em" fill="${C.ink}">S<tspan font-size="64" fill="${C.bronze}" dy="-14"> &amp; </tspan><tspan dy="14">T</tspan></text>`,
    `<text x="300" y="458" text-anchor="middle" font-family="${FONT_NUMERAL}" font-size="34" font-weight="600" letter-spacing="0.22em" fill="${C.bronze}">07 · 17 · 27</text>`,
    `<polyline points="286,428 300,442 314,428" fill="none" stroke="${C.gold}" stroke-width="1.5"/>`,
  ].join('');
  return { file: 'monogram-frame.svg', width: w, height: h, alt: 'Monogram plaque: the letters S and T joined by an ampersand inside a double gold octagon, with the date 07 · 17 · 27 beneath.', svg: svg({ w, h, title: 'S &amp; T monogram', desc: 'Octagonal monogram plaque with the wedding date motif 07 · 17 · 27.', body }) };
}

// 6. Marble texture: light Carrara-style ground. Deterministic: fixed-seed turbulence displaces hand-plotted veins.
function marbleTexture() {
  const w = 800, h = 800;
  const veins = [];
  // Six veins plotted from a formula (no randomness); each is a gentle diagonal with two bends.
  for (let i = 0; i < 6; i++) {
    const y0 = 60 + i * 130, dx = 90 + (i % 3) * 40;
    const d = `M-40 ${y0} C ${200 + dx} ${y0 - 60 + i * 8}, ${380 - dx} ${y0 + 90}, ${560} ${y0 + 30 + (i % 2) * 40} S ${760} ${y0 + 20}, ${860} ${y0 + 80}`;
    veins.push(`<path d="${d}" fill="none" stroke="${C.outline}" stroke-width="${i % 2 === 0 ? 1.6 : 0.9}" opacity="${i % 2 === 0 ? 0.55 : 0.4}"/>`);
    veins.push(`<path d="${d}" fill="none" stroke="${C.creme}" stroke-width="${i % 2 === 0 ? 5 : 3}" opacity="0.28"/>`);
  }
  const defs = [
    `<filter id="vein" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.011 0.006" numOctaves="3" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="46" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="0.6"/></filter>`,
    `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="17" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 0.11  0 0 0 0 0.106  0 0 0 0 0.094  0 0 0 0.05 0"/></filter>`,
  ].join('');
  const body = [
    `<rect width="${w}" height="${h}" fill="${C.marble}"/>`,
    `<g filter="url(#vein)">${veins.join('')}</g>`,
    `<rect width="${w}" height="${h}" filter="url(#grain)"/>`,
  ].join('');
  return { file: 'marble-texture.svg', width: w, height: h, alt: 'Pale marble texture: warm white ground with faint diagonal grey veins.', svg: svg({ w, h, title: 'Marble ground', desc: 'Subtle Carrara-style marble background tile.', body, defs }) };
}

// 7. Numeral badges: octagonal plaques for the five section numbers (Adventure, Place, Memory, Hospitality, Future).
function numeralBadge(n) {
  const w = 200, h = 200, label = String(n).padStart(2, '0');
  const body = [
    `<path d="${octagonPath(4, 4, 192, 192, 34)}" fill="${C.goldWash}" stroke="${C.gold}" stroke-width="2.5"/>`,
    `<path d="${octagonPath(14, 14, 172, 172, 30)}" fill="none" stroke="${C.gold}" stroke-width="1"/>`,
    `<text x="100" y="128" text-anchor="middle" font-family="${FONT_NUMERAL}" font-size="88" font-weight="600" letter-spacing="0.04em" fill="${C.ink}">${label}</text>`,
    `<line x1="70" y1="148" x2="130" y2="148" stroke="${C.gold}" stroke-width="1.5"/>`,
  ].join('');
  return { file: `numeral-badge-${label}.svg`, width: w, height: h, alt: `Octagonal gold-edged plaque with the section number ${label}.`, svg: svg({ w, h, title: `Section ${label}`, desc: 'Numbered octagonal plaque for a section heading.', body }) };
}

export function generate() {
  return [
    sunburstHero(),
    chevronDivider(),
    steppedFrame(),
    cornerBracket(),
    monogramFrame(),
    marbleTexture(),
    ...[1, 2, 3, 4, 5].map(numeralBadge),
  ];
}
