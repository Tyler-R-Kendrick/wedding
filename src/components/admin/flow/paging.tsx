import './flow.css';

/** Rows a long list shows at once. Search narrows it; the links below the list page through it. */
export const PAGE_SIZE = 50;

export interface Paging<T> {
  rows: T[];
  page: number;
  pages: number;
  total: number;
}

/**
 * One page of a long list, from the page's `?page=`. Every row is a handful of flows, so a list of a
 * few hundred guests on one screen was a megabyte of HTML and seconds of server rendering; fifty at
 * a time keeps each screen quick, and search finds anyone directly.
 */
export function paged<T>(rows: T[], page: string | undefined, size = PAGE_SIZE): Paging<T> {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const asked = Math.floor(Number(page));
  const p = Number.isFinite(asked) && asked >= 1 ? Math.min(asked, pages) : 1;
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages, total: rows.length };
}

/**
 * "51–100 of 312" with Previous and Next, keeping the page's other search parameters. Renders
 * nothing when the list fits on one page.
 */
export function PageLinks({ paging, path, params, noun, anchor, size = PAGE_SIZE }: { paging: Paging<unknown>; path: string; params: Record<string, string | string[] | undefined>; noun: string; anchor?: string; size?: number }) {
  if (paging.pages <= 1) return null;
  const href = (page: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      const value = Array.isArray(v) ? v[0] : v;
      if (value && k !== 'page' && k !== 'ok' && k !== 'error') q.set(k, value);
    }
    if (page > 1) q.set('page', String(page));
    const s = q.toString();
    return `${s ? `${path}?${s}` : path}${anchor ? `#${anchor}` : ''}`;
  };
  const from = (paging.page - 1) * size + 1;
  const to = from + paging.rows.length - 1;
  return (
    <nav className="flow-pages" aria-label={`Pages of ${noun}`}>
      <p className="flow-pages__count">
        {from}–{to} of {paging.total} {noun}
      </p>
      {paging.page > 1 ? <a href={href(paging.page - 1)}>Previous {size}</a> : null}
      {paging.page < paging.pages ? <a href={href(paging.page + 1)}>Next {Math.min(size, paging.total - to)}</a> : null}
    </nav>
  );
}
