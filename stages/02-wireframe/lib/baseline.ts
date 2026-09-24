/**
 * The baseline: every page as the real site renders it, captured by `npm run stages:capture`
 * (scripts/stages/capture.ts) into stages/02-wireframe/baseline/. Stages 2, 3 and 4 redraw it, so
 * they share production's markup, stylesheets and layout at every width and differ only in fidelity:
 *
 *   wireframe     the real layout, greyed: every surface and block outlined, copy as lines,
 *                 media as crossed boxes, headings and labels kept, each block labelled.
 *   skeleton      the real layout with its content as bones. Labels (navigation, buttons, form
 *                 labels) stay readable and every link still goes where it went.
 *   placeholder   the real page in its real design, copy swapped for stand-ins sized to it and
 *                 photographs for labelled panels; one document per design the capture holds.
 *
 * Each stage page shows its document in a same-origin frame, so the real CSS lays the page out in
 * a viewport of its own. Server-only (it reads files): route handlers and server components.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DESIGNS = ['botanical-deco', 'gilded-hour', 'conservatory'] as const;
export type Design = (typeof DESIGNS)[number];
export const DESIGN_NAMES: Record<Design, string> = {
  'botanical-deco': 'Botanical Deco (production)',
  'gilded-hour': 'Gilded Hour',
  conservatory: 'Conservatory',
};
export type FrameStage = 'wireframe' | 'skeleton' | 'placeholder';

export interface BaselineMeta {
  title: string;
  url: string;
  finalUrl: string;
  source: string;
  principal: 'guest' | 'admin' | null;
  capturedAt: string;
  designs: Partial<Record<Design, { status: number; file: string; same?: Design }>>;
}
interface Capture {
  htmlAttrs: Record<string, string>;
  bodyAttrs: Record<string, string>;
  css: string[];
  assets: string[];
  body: string;
}

/** Stage builds run in their own directory, tests and scripts from the repo root. */
export function baselineDir(): string {
  const candidates = [process.env.STAGES_BASELINE_DIR, path.resolve(process.cwd(), '../02-wireframe/baseline'), path.resolve(process.cwd(), 'baseline'), path.resolve(process.cwd(), 'stages/02-wireframe/baseline')];
  return candidates.find((d): d is string => !!d && existsSync(path.join(d, 'index.json'))) ?? path.resolve(process.cwd(), 'stages/02-wireframe/baseline');
}
const repoRoot = () => path.resolve(baselineDir(), '../../..');

let cached: Record<string, BaselineMeta> | null = null;
export function baselineIndex(): Record<string, BaselineMeta> {
  if (cached) return cached;
  const file = path.join(baselineDir(), 'index.json');
  cached = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).pages as Record<string, BaselineMeta>) : {};
  return cached;
}
export const baselineFor = (pageId: string): BaselineMeta | undefined => baselineIndex()[pageId];

/**
 * The designs this page was captured in, production's first. A design that renders the page exactly
 * as another does (the admin console looks the same in all of them) is not offered twice.
 */
export function designsFor(pageId: string): Design[] {
  const meta = baselineFor(pageId);
  return meta ? DESIGNS.filter((d) => meta.designs[d] && !meta.designs[d]!.same) : [];
}

function capture(pageId: string, design: Design): Capture | undefined {
  const entry = baselineFor(pageId)?.designs[design];
  if (!entry) return undefined;
  const file = path.join(baselineDir(), 'pages', pageId, entry.file);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Capture) : undefined;
}

/** `home.html` for production's design, `home.gilded-hour.html` for another. */
export function frameName(pageId: string, design: Design = DESIGNS[0]): string {
  return design === DESIGNS[0] ? `${pageId}.html` : `${pageId}.${design}.html`;
}
export function frameFiles(stage: FrameStage): string[] {
  return Object.keys(baselineIndex()).flatMap((id) => (stage === 'placeholder' ? designsFor(id) : designsFor(id).slice(0, 1)).map((d) => frameName(id, d)));
}
export function parseFrameName(file: string): { pageId: string; design: Design } | null {
  const m = file.match(/^(.+?)(?:\.([a-z-]+))?\.html$/);
  if (!m) return null;
  const design = (m[2] ?? DESIGNS[0]) as Design;
  return baselineFor(m[1]!) && DESIGNS.includes(design) ? { pageId: m[1]!, design } : null;
}

// --- Shared files: stylesheets and the assets they (and the markup) point at. ------------------------
function allCaptures(): Capture[] {
  return Object.keys(baselineIndex()).flatMap((id) => designsFor(id).map((d) => capture(id, d)).filter((c): c is Capture => !!c));
}
export const cssFiles = (): string[] => [...new Set(allCaptures().flatMap((c) => c.css))].map((h) => `${h}.css`);

const withBase = (base: string, p: string) => `${base}/baseline/a${p}`;
export function stylesheet(file: string, base: string): string | null {
  const f = path.join(baselineDir(), 'css', path.basename(file));
  if (!existsSync(f)) return null;
  return readFileSync(f, 'utf8').replace(/url\("(\/[^"]*)"\)/g, (_all, p: string) => `url("${withBase(base, p)}")`);
}

/** Where an asset's bytes are: the real app's public/ (same code as production), or a captured copy. */
function assetSource(p: string): string | null {
  const clean = p.split('?')[0]!;
  for (const dir of [path.join(repoRoot(), 'public'), path.join(baselineDir(), 'assets')]) {
    const f = path.join(dir, clean);
    if (f.startsWith(dir + path.sep) && existsSync(f)) return f;
  }
  return null;
}
export function assetFiles(): string[][] {
  const paths = new Set(allCaptures().flatMap((c) => c.assets));
  return [...paths].filter((p) => assetSource(p)).map((p) => p.split('?')[0]!.split('/').filter(Boolean));
}
export function asset(segments: string[]): Buffer | null {
  const f = assetSource(`/${segments.join('/')}`);
  return f ? readFileSync(f) : null;
}

// --- The transforms. -------------------------------------------------------------------------------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const STAND_IN = ['Stand-in', 'copy', 'sized', 'to', 'the', 'real', 'text'];
/**
 * Copy of the same length that says what it is. Numbers become zeros (a date keeps its shape),
 * symbols stay, capitals are kept where the original had them.
 */
export function standIn(text: string): string {
  const lead = text.match(/^\s*/)![0];
  const trail = text.match(/\s*$/)![0];
  const core = text.trim();
  if (!/[A-Za-z]/.test(core)) return lead + core.replace(/\d/g, '0') + trail;
  // Too short to say what it is ("Jul", "Sat"): letters become x, in the original's case.
  if (core.replace(/[^A-Za-z]/g, '').length <= 4 && !/\s/.test(core)) return lead + core.replace(/[a-z]/g, 'x').replace(/[A-Z]/g, 'X').replace(/\d/g, '0') + trail;
  const words: string[] = [];
  let length = 0;
  for (let i = 0; length < core.length; i++) {
    const w = STAND_IN[i % STAND_IN.length]!;
    words.push(i === 0 ? w : w.toLowerCase());
    length += w.length + (i ? 1 : 0);
  }
  let out = words.join(' ');
  if (out.length > core.length + 3) out = out.slice(0, core.length).replace(/\s+\S*$/, '') || out.slice(0, core.length);
  if (core === core.toUpperCase()) out = out.toUpperCase();
  else if (core[0] === core[0]!.toLowerCase()) out = out[0]!.toLowerCase() + out.slice(1);
  const end = core.match(/[.!?:;,…]$/);
  return lead + out + (end ? end[0] : '') + trail;
}

/** Internal links and asset references in the captured markup, re-rooted at this stage's base. */
export function transformBody(body: string, stage: FrameStage, base: string): string {
  let out = body
    .replace(/(<a\b[^>]*?\shref=")\/(?!\/)/g, `$1${base}/`)
    .replace(/(\ssrc=")\/(?!\/)/g, `$1${base}/baseline/a/`)
    .replace(/(<use\b[^>]*?\s(?:xlink:)?href=")\/(?!\/)/g, `$1${base}/baseline/a/`)
    .replace(/url\((&quot;|"|')?\/(?!\/)/g, (_all, q = '') => `url(${q}${base}/baseline/a/`);
  if (stage === 'placeholder') {
    out = out.replace(/<span data-bl-t="copy">([^<]*)<\/span>/g, (_all, t: string) => `<span data-bl-t="copy">${esc(standIn(unesc(t)))}</span>`);
  }
  return out;
}

/** Markup without its words: text, and the attributes that carry words or live values, removed. */
export function shapeOf(body: string): string {
  return body.replace(/>[^<]+</g, '><').replace(/\s(?:data-bl-label|alt|title|aria-label|placeholder|value|content|datetime|style)="[^"]*"/g, '');
}

/** The page's shape without its words: what a sign-off approves. Copy edits do not change it. */
export function structureFingerprint(pageId: string): string | null {
  const c = capture(pageId, DESIGNS[0]);
  return c ? createHash('sha256').update(shapeOf(c.body)).digest('hex').slice(0, 8) : null;
}

const CROSS = (line: string, fill: string) => `linear-gradient(to top right, transparent calc(50% - .5px), ${line} 50%, transparent calc(50% + .5px)), linear-gradient(to bottom right, transparent calc(50% - .5px), ${line} 50%, transparent calc(50% + .5px)), ${fill}`;
const PHOTO_LABEL = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="40"><text x="110" y="25" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="13" fill="#5A5E58">photograph</text></svg>')}")`;

/**
 * Appended after the real stylesheets. Only the pipeline's own palette, the steps of the root
 * DESIGN.md that stages/01-sitemap/lib/chrome/stage.css names (written out, because a frame does
 * not load stage.css): paper #F6F1E9, surface #FBF8F3, fill #E8DFD2, line #CFC5B6, ink #1F2A24,
 * muted ink #5A5E58, mark #A94A34. Layout is untouched.
 */
const PALETTE = '--bl-paper: #F6F1E9; --bl-surface: #FBF8F3; --bl-fill: #E8DFD2; --bl-line: #CFC5B6; --bl-ink: #1F2A24; --bl-muted: #5A5E58; --bl-mark: #A94A34;';
export const STAGE_CSS: Record<FrameStage, string> = {
  wireframe: `
html[data-bl-stage] { ${PALETTE} }
html[data-bl-stage], html[data-bl-stage] body { background: var(--bl-surface) !important; }
html[data-bl-stage] body * { color: var(--bl-muted) !important; background-color: transparent !important; background-image: none !important; box-shadow: none !important; text-shadow: none !important; border-color: var(--bl-line) !important; filter: none !important; }
html[data-bl-stage] [data-bl-s] { background-color: var(--bl-paper) !important; }
html[data-bl-stage] [data-bl-s][data-bl-dark] { background-color: var(--bl-fill) !important; }
html[data-bl-stage] [data-bl-k] { outline: 1px dashed var(--bl-line); outline-offset: -1px; }
html[data-bl-stage] [data-bl-t="heading"] { color: var(--bl-ink) !important; }
html[data-bl-stage] [data-bl-t="copy"] { color: transparent !important; background: linear-gradient(var(--bl-line), var(--bl-line)) 0 62% / 100% .3em no-repeat !important; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
html[data-bl-stage] img[data-bl-m], html[data-bl-stage] [data-bl-m="photo"], html[data-bl-stage] svg[data-bl-m="art"] { object-position: -99999px 0 !important; background: ${CROSS('var(--bl-line)', 'var(--bl-paper)')} !important; outline: 1px solid var(--bl-line); }
html[data-bl-stage] svg[data-bl-m="art"] > * { visibility: hidden; }
.bl-tag { position: absolute; z-index: 2147483646; pointer-events: none; font: 11px/1.5 ui-monospace, Menlo, monospace; color: var(--bl-mark); background: var(--bl-surface); padding: 0 4px; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }
`,
  skeleton: `
html[data-bl-stage] { ${PALETTE} }
html[data-bl-stage], html[data-bl-stage] body { background: var(--bl-paper) !important; }
html[data-bl-stage] body * { color: var(--bl-muted) !important; background-color: transparent !important; background-image: none !important; box-shadow: none !important; text-shadow: none !important; border-color: var(--bl-line) !important; filter: none !important; }
html[data-bl-stage] [data-bl-s] { background-color: var(--bl-surface) !important; }
html[data-bl-stage] [data-bl-s][data-bl-dark] { background-color: var(--bl-fill) !important; }
html[data-bl-stage] [data-bl-t="copy"], html[data-bl-stage] [data-bl-t="heading"] { color: transparent !important; background-color: var(--bl-fill) !important; border-radius: 2px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
html[data-bl-stage] [data-bl-dark] [data-bl-t="copy"], html[data-bl-stage] [data-bl-dark] [data-bl-t="heading"] { background-color: var(--bl-line) !important; }
html[data-bl-stage] img[data-bl-m], html[data-bl-stage] [data-bl-m="photo"], html[data-bl-stage] svg[data-bl-m="art"] { object-position: -99999px 0 !important; background-color: var(--bl-fill) !important; border-radius: 6px; }
html[data-bl-stage] svg[data-bl-m="art"] > * { visibility: hidden; }
`,
  placeholder: `
html[data-bl-stage] img[data-bl-m="photo"], html[data-bl-stage] [data-bl-m="photo"] { object-position: -99999px 0 !important; background: ${PHOTO_LABEL} center / auto no-repeat, #E8DFD2 !important; }
`,
};

/**
 * Makes the captured page behave without the site's JavaScript: a Menu (or any dialog trigger) opens
 * its dialog, a form never leaves the stage, and in the wireframe every block is labelled in an
 * overlay that does not touch the layout.
 */
const SHIM = (stage: FrameStage) => `(() => {
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[aria-haspopup="dialog"][aria-controls]');
    if (trigger) {
      const d = document.getElementById(trigger.getAttribute('aria-controls'));
      if (d && d.showModal) { e.preventDefault(); d.open ? d.close() : d.showModal(); trigger.setAttribute('aria-expanded', String(d.open)); }
      return;
    }
    const d = e.target.closest('dialog');
    if (d && (e.target === d || e.target.closest('button[type="button"]'))) d.close();
  });
  document.addEventListener('submit', (e) => e.preventDefault());
  ${stage === 'wireframe' ? `
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  const draw = () => {
    layer.textContent = '';
    for (const el of document.querySelectorAll('[data-bl-k]')) {
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 28) continue;
      const tag = document.createElement('span');
      tag.className = 'bl-tag';
      tag.textContent = el.getAttribute('data-bl-k') + (el.getAttribute('data-bl-label') ? ' · ' + el.getAttribute('data-bl-label') : '');
      tag.style.left = (r.left + scrollX) + 'px';
      tag.style.top = (r.top + scrollY) + 'px';
      layer.appendChild(tag);
    }
  };
  addEventListener('load', draw);
  addEventListener('resize', draw);
  new ResizeObserver(draw).observe(document.body);` : ''}
})();`;

export function frameDocument(pageId: string, design: Design, stage: FrameStage, base: string): string | null {
  const c = capture(pageId, design);
  const meta = baselineFor(pageId);
  if (!c || !meta) return null;
  const attrs = (a: Record<string, string>) => Object.entries(a).map(([k, v]) => ` ${k}="${attr(v)}"`).join('');
  const links = c.css.map((h) => `<link rel="stylesheet" href="${base}/baseline/css/${h}.css">`).join('\n');
  return `<!doctype html>
<html${attrs(c.htmlAttrs)} data-bl-stage="${stage}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<base target="_top">
<title>${esc(meta.title)}</title>
${links}
<style>${STAGE_CSS[stage]}</style>
</head>
<body${attrs(c.bodyAttrs)}>
${transformBody(c.body, stage, base)}
<script>${SHIM(stage)}</script>
</body>
</html>
`;
}
