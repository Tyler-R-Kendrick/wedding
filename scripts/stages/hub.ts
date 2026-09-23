/**
 * Writes the dev hub (public/_stages/_hub/index.html): what each stage is for, a way into it,
 * and the promotion board, which shows where every page stands at every stage and who signed it off.
 *
 *   node --import tsx scripts/stages/hub.ts <dist>     # assemble.mjs runs this last
 *
 * Plain static HTML, drawn with the pipeline's own tokens (stages/01-sitemap/lib/chrome/stage.css,
 * inlined), so the hub needs no build of its own. Links default to path addressing
 * (`/wireframe/rsvp`), served outside production; a few lines of script switch them to the
 * stage subdomains when the hub is viewed at `dev.<domain>`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIPELINE_STAGES, SECTIONS, STAGES, type Stage } from '@wedding/sitemap';
import { board, readSignoffs, type Approval, type BoardRow, type SignableStage } from './board';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.resolve(process.argv[2] ?? path.join(ROOT, 'public/_stages'));
const tokens = readFileSync(path.join(ROOT, 'stages/01-sitemap/lib/chrome/stage.css'), 'utf8');
const realUrl = process.env.NEXT_PUBLIC_STAGE_URL_REAL?.replace(/\/$/, '');

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Where a hub link goes. With STAGES_DEV_DOMAIN (dev.kendrick.wedding, set by the production
 * build) the links are the stage subdomains outright; otherwise they are paths, which work on
 * previews and locally, and the script below switches them to subdomains on any dev.* host.
 */
const devDomain = process.env.STAGES_DEV_DOMAIN?.replace(/\/$/, '');
const pathOf = (url: string) => (url === '/' ? '' : url);

function stageLink(stage: Stage, url: string, text: string, extra = ''): string {
  if (stage.id === 'real') {
    const href = realUrl ? realUrl + url : devDomain ? `https://${devDomain.replace(/^dev\./, '')}${url}` : url;
    return `<a href="${esc(href)}" data-real="${esc(url)}"${extra}>${text}</a>`;
  }
  const href = devDomain ? `https://${stage.id}.${devDomain}${url}` : `/${stage.id}${pathOf(url)}`;
  return `<a href="${esc(href)}" data-stage="${stage.id}" data-path="${esc(url)}"${extra}>${text}</a>`;
}

const LABEL: Record<Approval['state'], string> = { open: 'open', signed: 'signed off', stale: 'stale' };

function approvalCell(stage: Stage, row: BoardRow, approval: Approval, prefix = ''): string {
  const who = approval.state === 'open' ? '' : ` <span class="hub-muted">${esc(approval.by)}, ${esc(approval.on)}</span>`;
  const title = approval.state === 'stale' ? ' title="The wireframe changed after this sign-off"' : approval.state === 'signed' && approval.note ? ` title="${esc(approval.note)}"` : '';
  return `<td data-state="${approval.state}"${title}>${stageLink(stage, row.url, `${prefix}${LABEL[approval.state]}`)}${who}</td>`;
}

function rowHtml(row: BoardRow): string {
  const [sitemap, wireframe, skeleton, placeholder, real] = STAGES as [Stage, Stage, Stage, Stage, Stage];
  const a = row.approvals as Record<SignableStage, Approval>;
  const drawn = row.wireframe.status === 'derived' ? 'not drawn · ' : `${row.wireframe.status} · `;
  return `<tr>
  <th scope="row">${stageLink(sitemap, row.url, esc(row.page.title))} <code>${esc(row.page.path)}</code></th>
  ${approvalCell(wireframe, row, a.wireframe, drawn)}
  ${approvalCell(skeleton, row, a.skeleton)}
  ${approvalCell(placeholder, row, a.placeholder)}
  <td>${stageLink(real, row.url, 'served')}</td>
</tr>`;
}

const rows = board(readSignoffs());
const count = (state: Approval['state']) => rows.reduce((n, r) => n + Object.values(r.approvals).filter((x) => x.state === state).length, 0);
const [signed, stale, open] = [count('signed'), count('stale'), count('open')];

const stagesList = PIPELINE_STAGES.map(
  (s) => `<li><h3>${stageLink(s, '/', `${s.n}. ${esc(s.name)}`)}</h3><p>${esc(s.question)}</p></li>`,
).join('\n');

const boardHtml = SECTIONS.map((sec) => {
  const inSection = rows.filter((r) => r.page.audience === sec.id);
  return `<tbody><tr class="hub-section"><th scope="rowgroup" colspan="5">${esc(sec.title)} <span class="hub-muted">${inSection.length}</span></th></tr>
${inSection.map(rowHtml).join('\n')}</tbody>`;
}).join('\n');

const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%226%22 fill=%22%231F2A24%22/%3E%3Ctext x=%2216%22 y=%2223%22 text-anchor=%22middle%22 font-family=%22Georgia, serif%22 font-size=%2218%22 fill=%22%23F6F1E9%22%3E%E2%80%A6%3C/text%3E%3C/svg%3E">
<title>${esc(title)}</title>
<style>
${tokens}
.hub { max-width: var(--st-page); margin: 0 auto; padding: var(--st-space-xl) var(--st-space-md) var(--st-space-2xl); }
.hub h1 { font-family: var(--st-font-display); font-size: var(--st-size-h1); font-weight: 400; line-height: 1.1; margin: 0 0 var(--st-space-md); }
.hub h2 { font-family: var(--st-font-display); font-size: var(--st-size-h2); font-weight: 400; margin: var(--st-space-2xl) 0 var(--st-space-sm); }
.hub h3 { font-size: var(--st-size-h3); font-weight: 400; margin: 0; }
.hub-lede { font-size: var(--st-size-h3); max-width: var(--st-measure); margin: 0; }
.hub-muted { color: var(--st-ink-muted); font-size: var(--st-size-small); }
.hub-stages { list-style: none; padding: 0; margin: var(--st-space-lg) 0 0; display: grid; gap: var(--st-space-md); }
.hub-stages li { padding: var(--st-space-md) 0; border-top: 1px solid var(--st-line); display: grid; gap: var(--st-space-xs); }
.hub-stages p { margin: 0; color: var(--st-ink-muted); max-width: var(--st-measure); }
.hub-stages a { display: inline-flex; align-items: center; min-block-size: 44px; }
@media (width >= 820px) { .hub-stages li { grid-template-columns: 16rem 1fr; align-items: baseline; } }
.hub-board-wrap { overflow-x: auto; border: 1px solid var(--st-line); border-radius: var(--st-radius); background: var(--st-surface); }
.hub-board { border-collapse: collapse; inline-size: 100%; font-size: var(--st-size-small); }
.hub-board th, .hub-board td { padding: var(--st-space-sm); border-bottom: 1px solid var(--st-line); text-align: left; vertical-align: top; min-inline-size: 9rem; }
.hub-board thead th { font-family: var(--st-font-note); font-weight: 400; color: var(--st-ink-muted); }
.hub-board tbody th { font-weight: 400; }
.hub-board code { display: block; font-family: var(--st-font-note); color: var(--st-ink-muted); }
.hub-section th { background: var(--st-fill); font-family: var(--st-font-display); font-size: var(--st-size-h3); }
.hub-board td[data-state="signed"] { box-shadow: inset 4px 0 0 var(--st-ink); }
.hub-board td[data-state="stale"] { box-shadow: inset 4px 0 0 var(--st-mark); color: var(--st-mark); }
.hub-board td[data-state="stale"] a { color: var(--st-mark); }
.hub-key { display: flex; flex-wrap: wrap; gap: var(--st-space-sm) var(--st-space-lg); padding: 0; list-style: none; }
.hub-addr { font-family: var(--st-font-note); font-size: var(--st-size-small); }
</style>
</head>
<body>
<a class="st-skip" href="#main">Skip to content</a>
<main id="main" class="hub">
${body}
</main>
<script>
// On a dev.* host every stage has its own subdomain, and the real site is that host without dev.
(function () {
  var host = location.host;
  if (!/^dev\./.test(host)) return;
  document.querySelectorAll('a[data-stage]').forEach(function (a) {
    a.href = location.protocol + '//' + a.dataset.stage + '.' + host + a.dataset.path;
  });
  document.querySelectorAll('a[data-real]').forEach(function (a) {
    a.href = location.protocol + '//' + host.replace(/^dev\./, '') + a.dataset.real;
  });
  document.querySelectorAll('[data-addressing]').forEach(function (el) { el.textContent = el.dataset.addressing.split('HOST').join(host); });
})();
</script>
</body>
</html>
`;

const hub = page(
  'Tyler & Sara · dev',
  `<h1>Tyler &amp; Sara, in five fidelities</h1>
<p class="hub-lede">Every page of the site goes sitemap, wireframe, skeleton, placeholder, real. Each stage answers one question, and is built from the one before it.</p>
<p class="hub-addr" data-addressing="Each stage is at its own address: sitemap.HOST, wireframe.HOST, skeleton.HOST, placeholder.HOST.">${devDomain ? `Each stage is at its own address: sitemap.${esc(devDomain)}, wireframe.${esc(devDomain)}, skeleton.${esc(devDomain)}, placeholder.${esc(devDomain)}.` : 'Each stage is at /sitemap, /wireframe, /skeleton and /placeholder on this host.'}</p>
<h2>Stages</h2>
<ol class="hub-stages">
${stagesList}
<li><h3>${stageLink(STAGES[4]!, '/', '5. Real')}</h3><p>${esc(STAGES[4]!.question)}</p></li>
</ol>
<h2 id="board">Where every page stands</h2>
<p class="hub-lede">${rows.length} pages. ${signed} sign-offs hold, ${stale} are stale (the wireframe changed after them), ${open} are open.</p>
<ul class="hub-key hub-muted">
<li><strong>signed off</strong>: settled at that stage, for the wireframe as it is now</li>
<li><strong>stale</strong>: signed off, then the wireframe changed; look again</li>
<li><strong>open</strong>: not signed off yet</li>
</ul>
<p class="hub-muted">Sign a page off with <code>npm run stages:signoff -- &lt;stage&gt; &lt;pageId&gt; --by &lt;name&gt;</code>; the ledger is <code>stages/signoffs.json</code>.</p>
<div class="hub-board-wrap" tabindex="0" role="region" aria-labelledby="board">
<table class="hub-board">
<caption class="hub-muted">Each cell links to that page at that stage.</caption>
<thead><tr><th scope="col">1. Sitemap</th><th scope="col">2. Wireframe</th><th scope="col">3. Skeleton</th><th scope="col">4. Placeholder</th><th scope="col">5. Real</th></tr></thead>
${boardHtml}
</table>
</div>`,
);

mkdirSync(dist, { recursive: true });
// Served at dev.<domain>/ and, outside production, at /stages (src/lib/stage-hosting.ts).
mkdirSync(path.join(dist, '_hub'), { recursive: true });
writeFileSync(path.join(dist, '_hub', 'index.html'), hub);
console.log(`hub: ${rows.length} pages, ${signed} signed, ${stale} stale, ${open} open → ${path.relative(ROOT, dist)}/_hub/index.html`);
