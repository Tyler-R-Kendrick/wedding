import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  LIFECYCLE_STATES,
  PAGES,
  SECTIONS,
  children,
  href,
  page as pageById,
  pageForUrl,
  pagesIn,
  staticParams,
  trail,
  validateSitemap,
  visibleIn,
  withBase,
  type SitemapPage,
} from '@wedding/sitemap';
import { StageBar } from '@wedding/sitemap/chrome';

type Params = Promise<{ path?: string[] }>;

export const dynamicParams = false;

/** `/` is the map; every other sitemap URL is that page's card. */
export function generateStaticParams() {
  return staticParams();
}

function urlOf(segments: string[] | undefined): string {
  return `/${(segments ?? []).join('/')}`;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const url = urlOf((await params).path);
  if (url === '/') return {};
  return { title: pageForUrl(url)?.title ?? 'Not in the sitemap' };
}

export default async function Page({ params }: { params: Params }) {
  const url = urlOf((await params).path);
  const p = pageForUrl(url);
  if (!p) notFound();
  return (
    <>
      <StageBar current="sitemap" path={url} />
      <main id="main" className="sm">
        {url === '/' ? <MapView /> : <NodeView p={p} />}
      </main>
    </>
  );
}

const STATE_LABEL: Record<(typeof LIFECYCLE_STATES)[number], string> = {
  TEASER: 'Teaser',
  SAVE_THE_DATE: 'Save the date',
  INVITATIONS_OPEN: 'Invitations',
  RSVP_OPEN: 'RSVP open',
  RSVP_CLOSED: 'RSVP closed',
  WEDDING_WEEK: 'Week of',
  WEDDING_DAY: 'The day',
  POST_WEDDING: 'After',
  ARCHIVE: 'Archive',
};

function MapView() {
  const errors = validateSitemap();
  const guestFacing = PAGES.filter((p) => p.audience !== 'admin');
  return (
    <>
      <header className="sm-head">
        <h1>Tyler &amp; Sara: every page</h1>
        <p className="sm-lede">
          {PAGES.length} pages in {SECTIONS.length} sections. This map is the source every later stage reads:
          change a page here and the wireframe, skeleton and placeholder builds follow it.
        </p>
        {errors.length > 0 && (
          <div className="sm-errors" role="alert">
            <h2>The sitemap has {errors.length} problem{errors.length === 1 ? '' : 's'}</h2>
            <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
      </header>

      {SECTIONS.map((s) => {
        const pages = pagesIn(s.id);
        const roots = pages.filter((p) => !p.parent || pageById(p.parent).audience !== s.audience);
        return (
          <section key={s.id} className="sm-section" aria-labelledby={`sec-${s.id}`}>
            <h2 id={`sec-${s.id}`}>
              {s.title} <span className="sm-count">{pages.length}</span>
            </h2>
            <p className="sm-blurb">{s.blurb}</p>
            <ul className="sm-tree">
              {roots.map((p) => <TreeNode key={p.id} p={p} audience={s.audience} />)}
            </ul>
          </section>
        );
      })}

      <section className="sm-section" aria-labelledby="sec-lifecycle">
        <h2 id="sec-lifecycle">When each page appears</h2>
        <p className="sm-blurb">
          The site moves through {LIFECYCLE_STATES.length} states. A page is reachable from its first state on; admin pages are always on.
        </p>
        <div className="sm-matrix-wrap" tabIndex={0} role="region" aria-label="Lifecycle visibility, scrolls sideways">
          <table className="sm-matrix">
            <thead>
              <tr>
                <th scope="col">Page</th>
                {LIFECYCLE_STATES.map((st) => <th key={st} scope="col">{STATE_LABEL[st]}</th>)}
              </tr>
            </thead>
            <tbody>
              {guestFacing.map((p) => (
                <tr key={p.id}>
                  <th scope="row"><Link href={href(p)}>{p.title}</Link></th>
                  {LIFECYCLE_STATES.map((st) => (
                    <td key={st} data-on={visibleIn(p, st) || undefined}>
                      <span className="sm-visually-hidden">{visibleIn(p, st) ? 'visible' : 'hidden'}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="sm-foot">
        As data: <a href={withBase('/sitemap.json')}>sitemap.json</a>. Source: <code>stages/01-sitemap/lib/sitemap.ts</code>.
      </p>
    </>
  );
}

function TreeNode({ p, audience }: { p: SitemapPage; audience: SitemapPage['audience'] }) {
  const kids = children(p.id).filter((c) => c.audience === audience);
  return (
    <li className="sm-node">
      <Link className="sm-node__card" href={href(p)}>
        <span className="sm-node__title">{p.title}</span>
        <code className="sm-node__path">{p.path}</code>
        <span className="sm-node__job">{p.job}</span>
        {p.visibleFrom && <span className="sm-node__meta">from {STATE_LABEL[p.visibleFrom]}</span>}
      </Link>
      {kids.length > 0 && (
        <ul className="sm-tree">
          {kids.map((c) => <TreeNode key={c.id} p={c} audience={audience} />)}
        </ul>
      )}
    </li>
  );
}

function NodeView({ p }: { p: SitemapPage }) {
  const crumbs = trail(p.id);
  const kids = children(p.id);
  const action = p.primaryAction ? pageById(p.primaryAction.to) : null;
  return (
    <article className="sm-card">
      <nav aria-label="Breadcrumb">
        <ol className="sm-crumbs">
          <li><Link href="/">Map</Link></li>
          {crumbs.map((c) => (
            <li key={c.id}>
              {c.id === p.id ? <span aria-current="page">{c.title}</span> : <Link href={href(c)}>{c.title}</Link>}
            </li>
          ))}
        </ol>
      </nav>
      <h1>{p.title}</h1>
      <p className="sm-lede">{p.job}</p>
      <dl className="sm-facts">
        <div><dt>Route</dt><dd><code>{p.path}</code>{p.example && <> (e.g. <code>{p.example}</code>)</>}</dd></div>
        <div><dt>For</dt><dd>{SECTIONS.find((s) => s.id === p.audience)?.title}</dd></div>
        <div><dt>Visitor mode</dt><dd>{p.mode.join(', ')}</dd></div>
        <div><dt>Appears</dt><dd>{p.visibleFrom ? `from ${STATE_LABEL[p.visibleFrom]}` : 'always (signed-in admins)'}</dd></div>
        <div><dt>In the navigation</dt><dd>{p.inNav ? `yes, as "${p.navLabel ?? p.title}"` : 'no'}</dd></div>
        {action && (
          <div><dt>Primary action</dt><dd>{p.primaryAction!.label} → <Link href={href(action)}>{action.title}</Link></dd></div>
        )}
      </dl>
      {p.notes && (
        <>
          <h2>Notes</h2>
          <ul>{p.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </>
      )}
      {kids.length > 0 && (
        <>
          <h2>Below this page</h2>
          <ul>{kids.map((c) => <li key={c.id}><Link href={href(c)}>{c.title}</Link>: {c.job}</li>)}</ul>
        </>
      )}
    </article>
  );
}
