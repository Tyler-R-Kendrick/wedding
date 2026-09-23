import type { Metadata } from 'next';
import { SECTIONS, href, pagesIn } from '@wedding/sitemap';
import { StageBar } from '@wedding/sitemap/chrome';
import { coverage, validateWireframes, wireframeFor } from '@wedding/wireframe';

export const metadata: Metadata = { title: 'Every wireframe' };

/** The drawing board: every sitemap page, whether it has been drawn, and how far it has got. */
export default function Index() {
  const c = coverage();
  const errors = validateWireframes();
  return (
    <>
      <StageBar current="wireframe" path="/wireframes/" />
      <main id="main" className="gb-main gb-index">
        <h1 className="gb-h1">Every wireframe</h1>
        <p className="gb-lede">
          {c.total} pages: {c.approved} approved, {c.review} in review, {c.draft} draft, {c.derived} not drawn yet (derived from the sitemap).
        </p>
        {errors.length > 0 && (
          <div className="gb-errors" role="alert">
            <h2 className="gb-h2">{errors.length} wireframe problem{errors.length === 1 ? '' : 's'}</h2>
            <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        {SECTIONS.map((s) => (
          <section key={s.id} aria-labelledby={`s-${s.id}`}>
            <h2 className="gb-h2" id={`s-${s.id}`}>{s.title}</h2>
            <ul className="gb-index__list">
              {pagesIn(s.id).map((p) => {
                const w = wireframeFor(p.id);
                return (
                  <li key={p.id}>
                    <a href={href(p)}>{p.title}</a> <code>{p.path}</code>{' '}
                    <span className={`gb-pill gb-pill--${w.status}`}>{w.status === 'derived' ? 'not drawn' : w.status}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
