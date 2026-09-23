import { INTERNAL_ROUTES, PAGES, SECTIONS } from './sitemap';
import { LIFECYCLE_STATES, type LifecycleState, type PageId, type SitemapPage } from './types';

export * from './types';
export * from './pipeline';
export { PAGES, SECTIONS, INTERNAL_ROUTES };

const byId = new Map(PAGES.map((p) => [p.id, p]));

export function page(id: PageId): SitemapPage {
  const p = byId.get(id);
  if (!p) throw new Error(`sitemap: no page with id "${id}"`);
  return p;
}

export function hasPage(id: PageId): boolean {
  return byId.has(id);
}

/** The URL every stage renders for a page: the pattern itself, or its example when patterned. */
export function href(p: SitemapPage): string {
  return p.example ?? p.path;
}

export function isPatterned(path: string): boolean {
  return path.includes('[');
}

/** `/our-adventures/[slug]` matches `/our-adventures/anything`. */
export function matches(pattern: string, url: string): boolean {
  const a = pattern.split('/').filter(Boolean);
  const b = url.split('?')[0]!.split('#')[0]!.split('/').filter(Boolean);
  return a.length === b.length && a.every((seg, i) => (seg.startsWith('[') ? b[i]!.length > 0 : seg === b[i]));
}

/** Resolves a concrete URL to its page, preferring an exact path over a pattern. */
export function pageForUrl(url: string): SitemapPage | undefined {
  const clean = `/${url.split('?')[0]!.split('#')[0]!.split('/').filter(Boolean).join('/')}`;
  return PAGES.find((p) => p.path === clean) ?? PAGES.find((p) => isPatterned(p.path) && matches(p.path, clean));
}

export function children(id: PageId): SitemapPage[] {
  return PAGES.filter((p) => p.parent === id);
}

/** Root first, the page itself last. */
export function trail(id: PageId): SitemapPage[] {
  const out: SitemapPage[] = [];
  for (let p: SitemapPage | undefined = page(id); p; p = p.parent ? byId.get(p.parent) : undefined) out.unshift(p);
  return out;
}

export function navLabel(p: SitemapPage): string {
  return p.navLabel ?? p.title;
}

/** Guest-facing navigation in sitemap order. */
export function navPages(): SitemapPage[] {
  return PAGES.filter((p) => p.inNav);
}

export function pagesIn(sectionId: string): SitemapPage[] {
  return PAGES.filter((p) => p.audience === sectionId);
}

export function visibleIn(p: SitemapPage, state: LifecycleState): boolean {
  if (p.visibleFrom === null) return p.audience === 'admin' || p.audience === 'gate';
  return LIFECYCLE_STATES.indexOf(state) >= LIFECYCLE_STATES.indexOf(p.visibleFrom);
}

/** Path segments for `generateStaticParams` on an optional catch-all route. */
export function staticParams(): { path: string[] }[] {
  return PAGES.map((p) => ({ path: href(p).split('/').filter(Boolean) }));
}

/**
 * Structural rules. Every stage's tests call this, so a broken sitemap fails the whole pipeline at
 * its root instead of surfacing as a strange render three stages later.
 */
export function validateSitemap(pages: SitemapPage[] = PAGES): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  const known = new Set(pages.map((p) => p.id));
  for (const p of pages) {
    if (ids.has(p.id)) errors.push(`duplicate id "${p.id}"`);
    if (paths.has(p.path)) errors.push(`duplicate path "${p.path}"`);
    ids.add(p.id);
    paths.add(p.path);
    if (!p.path.startsWith('/')) errors.push(`${p.id}: path must start with "/"`);
    if (isPatterned(p.path) && !p.example) errors.push(`${p.id}: patterned path ${p.path} needs an example URL`);
    if (p.example && !matches(p.path, p.example)) errors.push(`${p.id}: example ${p.example} does not match ${p.path}`);
    if (p.parent !== null && !known.has(p.parent)) errors.push(`${p.id}: parent "${p.parent}" is not in the sitemap`);
    if (p.primaryAction && !known.has(p.primaryAction.to)) errors.push(`${p.id}: primary action points at unknown page "${p.primaryAction.to}"`);
    if (p.audience === 'admin' && p.inNav) errors.push(`${p.id}: admin pages do not belong in the guest navigation`);
    if (!p.job.trim()) errors.push(`${p.id}: every page needs a job`);
  }
  // A parent chain must end at a root, never loop.
  for (const p of pages) {
    const seen = new Set<string>();
    for (let cur: SitemapPage | undefined = p; cur?.parent; cur = pages.find((q) => q.id === cur!.parent)) {
      if (seen.has(cur.id)) {
        errors.push(`${p.id}: parent chain loops`);
        break;
      }
      seen.add(cur.id);
    }
  }
  return errors;
}
