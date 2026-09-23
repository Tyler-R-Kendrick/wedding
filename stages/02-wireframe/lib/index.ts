import { PAGES, children, hasPage, page as sitemapPage, type PageId, type SitemapPage } from '@wedding/sitemap';
import type { Action, Block, Wireframe, WireframeSpec } from './types';
import { ADMIN } from './wireframes/admin';
import { GATE } from './wireframes/gate';
import { GUEST } from './wireframes/guest';
import { PUBLIC } from './wireframes/public';

export * from './types';

/** Every drawn page. A page missing here is still wireframed: see `derive`. */
export const AUTHORED: Record<PageId, WireframeSpec> = { ...PUBLIC, ...GUEST, ...GATE, ...ADMIN };

/**
 * The cascade's first step. A page added to the sitemap has a wireframe the moment it exists,
 * computed from what the sitemap already knows (its audience, job, children and primary action),
 * and marked `derived` so everyone can see it has not been drawn yet.
 */
export function derive(p: SitemapPage): Wireframe {
  const blocks: Block[] = [{ kind: 'masthead', title: p.title, lede: p.job }];
  const kids = children(p.id);
  if (p.audience === 'admin') {
    blocks.push({ kind: 'table', label: p.title, columns: ['Name', 'Status', 'Updated'], rows: 6, filters: ['Search'] });
  } else if (p.audience === 'gate') {
    blocks.push({ kind: 'form', label: p.title, submit: p.primaryAction?.label ?? 'Continue', next: p.primaryAction?.to, fields: [{ label: 'Email', type: 'email', required: true }] });
  } else {
    blocks.push({ kind: 'prose', label: 'What this page says', paragraphs: 2 });
  }
  if (kids.length > 0) blocks.push({ kind: 'collection', label: `Below ${p.title}`, item: 'Page', count: kids.length, layout: 'list', to: kids[0]!.id });
  if (p.primaryAction && p.audience !== 'gate') blocks.push({ kind: 'callout', label: 'Next', action: { label: p.primaryAction.label, to: p.primaryAction.to, variant: 'primary' } });
  return { page: p.id, status: 'derived', blocks, notes: ['Derived from the sitemap. Draw it in stages/02-wireframe/lib/wireframes/.'] };
}

export function wireframeFor(id: PageId): Wireframe {
  const spec = AUTHORED[id];
  if (!spec) return derive(sitemapPage(id));
  return { page: id, status: spec.status ?? 'draft', blocks: spec.blocks, notes: spec.notes };
}

export function allWireframes(): Wireframe[] {
  return PAGES.map((p) => wireframeFor(p.id));
}

/** Depth-first over nested blocks (tabs, split), with a stable id for each. */
export function walk(blocks: Block[], visit: (b: Block, id: string) => void, prefix = ''): void {
  blocks.forEach((b, i) => {
    const id = b.id ?? `${prefix}${b.kind}-${i}`;
    visit(b, id);
    if (b.kind === 'tabs') b.tabs.forEach((t, ti) => walk(t.blocks, visit, `${id}.${ti}.`));
    if (b.kind === 'split') b.columns.forEach((col, ci) => walk(col, visit, `${id}.${ci}.`));
  });
}

export function blockId(b: Block, index: number, prefix = ''): string {
  return b.id ?? `${prefix}${b.kind}-${index}`;
}

function actionsOf(b: Block): Action[] {
  switch (b.kind) {
    case 'masthead': return b.actions ?? [];
    case 'callout': return [b.action];
    default: return [];
  }
}

function linksOf(b: Block): PageId[] {
  const out = actionsOf(b).flatMap((a) => (a.to ? [a.to] : []));
  if (b.kind === 'collection' && b.to) out.push(b.to);
  if (b.kind === 'form' && b.next) out.push(b.next);
  if (b.kind === 'tasks') for (const t of b.tasks) if (t.to) out.push(t.to);
  return out;
}

/** Every page a wireframe links to. Stage 3 turns these into real navigation. */
export function linksFrom(w: Wireframe): PageId[] {
  const out = new Set<PageId>();
  walk(w.blocks, (b) => linksOf(b).forEach((to) => out.add(to)));
  return [...out];
}

/**
 * The rules a wireframe must keep for stage 3 to render it. A sitemap change that orphans a
 * wireframe or its links fails here, in stage 2's tests, before any later stage builds.
 */
export function validateWireframes(authored: Record<PageId, WireframeSpec> = AUTHORED): string[] {
  const errors: string[] = [];
  for (const [id, spec] of Object.entries(authored)) {
    if (!hasPage(id)) errors.push(`wireframe "${id}" has no page in the sitemap`);
    if (spec.blocks.length === 0) errors.push(`${id}: a wireframe needs at least one block`);
    if (spec.blocks[0]?.kind !== 'masthead') errors.push(`${id}: the first block must be the masthead (the page's h1)`);
    const seen = new Set<string>();
    walk(spec.blocks, (b, bid) => {
      if (seen.has(bid)) errors.push(`${id}: duplicate block id "${bid}"`);
      seen.add(bid);
      for (const to of linksOf(b)) if (!hasPage(to)) errors.push(`${id}/${bid}: links to "${to}", which the sitemap does not have`);
      for (const a of actionsOf(b)) if (!a.to && !a.external) errors.push(`${id}/${bid}: action "${a.label}" goes nowhere`);
      if (b.kind === 'form' && b.fields.length === 0) errors.push(`${id}/${bid}: a form needs fields`);
      if (b.kind === 'form') for (const f of b.fields) if ((f.type === 'radio' || f.type === 'select') && !f.options?.length) errors.push(`${id}/${bid}: "${f.label}" needs options`);
      if (b.kind === 'tabs' && b.tabs.length < 2) errors.push(`${id}/${bid}: tabs need at least two`);
    });
  }
  return errors;
}

export interface Coverage {
  total: number;
  derived: number;
  draft: number;
  review: number;
  approved: number;
}

export function coverage(): Coverage {
  const c: Coverage = { total: 0, derived: 0, draft: 0, review: 0, approved: 0 };
  for (const w of allWireframes()) {
    c.total++;
    c[w.status]++;
  }
  return c;
}

/**
 * A short, stable hash of what a page's wireframe says (its blocks and notes, not its status).
 * A sign-off records the fingerprint it approved (stages/signoffs.json), so when the wireframe
 * changes afterwards, every sign-off on that page reads as stale on the dev hub's board: the
 * cascade, applied to approvals. FNV-1a over canonical JSON; not a security hash.
 */
export function fingerprint(w: Wireframe): string {
  const canonical = JSON.stringify({ blocks: w.blocks, notes: w.notes ?? [] }, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
