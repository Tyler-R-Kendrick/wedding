import { href, navLabel, navPages, page as sitemapPage, type SitemapPage } from '@wedding/sitemap';
import { blockId, type Action, type Block, type Field, type Wireframe } from '@wedding/wireframe';
import type { ReactNode } from 'react';

/**
 * Stage 2's drawing kit: every block kind as a greybox. Deliberately static — boxes, bars and
 * labels. Clicking through flows is stage 3's job; here the only question is what goes where.
 */

function linkTo(to: string | undefined): string | undefined {
  return to ? href(sitemapPage(to)) : undefined;
}

function Lines({ n, last = 0.6 }: { n: number; last?: number }) {
  return (
    <span className="gb-lines" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="gb-line" style={{ inlineSize: i === n - 1 ? `${last * 100}%` : undefined }} />
      ))}
    </span>
  );
}

function Box({ label, aspect = 'wide' }: { label: string; aspect?: 'wide' | 'portrait' | 'square' }) {
  return (
    <div className={`gb-box gb-box--${aspect}`} role="img" aria-label={`Image: ${label}`}>
      <svg className="gb-box__x" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="0" x2="100" y2="100" />
        <line x1="100" y1="0" x2="0" y2="100" />
      </svg>
      <span className="gb-box__label">{label}</span>
    </div>
  );
}

function Button({ a }: { a: Action }) {
  const cls = `gb-button gb-button--${a.variant ?? 'secondary'}`;
  const to = linkTo(a.to);
  if (to) return <a className={cls} href={to}>{a.label}</a>;
  return <span className={cls}>{a.label} <span className="gb-ext">↗ {a.external}</span></span>;
}

function FieldDrawing({ f }: { f: Field }) {
  const label = `${f.label}${f.required ? ' *' : ''}`;
  if (f.type === 'radio' || f.type === 'checkbox') {
    return (
      <div className="gb-field">
        <span className="gb-field__label">{label}</span>
        <span className="gb-choices">
          {(f.options ?? ['Yes']).map((o) => (
            <span key={o} className="gb-choice"><span className={`gb-choice__mark gb-choice__mark--${f.type}`} aria-hidden="true" />{o}</span>
          ))}
        </span>
      </div>
    );
  }
  return (
    <div className="gb-field">
      <span className="gb-field__label">{label}</span>
      <span className={`gb-input gb-input--${f.type}`}>{f.type === 'select' ? `${f.options?.[0] ?? ''} ▾` : f.type === 'file' ? 'Choose files…' : ''}</span>
      {f.hint && <span className="gb-field__hint">{f.hint}</span>}
    </div>
  );
}

function Frame({ kind, id, label, note, children }: { kind: string; id: string; label?: string; note?: string; children: ReactNode }) {
  return (
    <section className={`gb-block gb-block--${kind}`} aria-label={label ?? kind} data-block={id}>
      <p className="gb-tag"><span className="gb-tag__kind">{kind}</span>{label && <> · {label}</>}</p>
      {children}
      {note && <p className="gb-note">{note}</p>}
    </section>
  );
}

export function BlockView({ b, id }: { b: Block; id: string }) {
  switch (b.kind) {
    case 'masthead':
      return (
        <Frame kind={b.kind} id={id} label="Page head" note={b.note}>
          <div className={`gb-masthead gb-masthead--${b.media ?? 'none'}`}>
            <div className="gb-masthead__text">
              <h1 className="gb-h1">{b.title}</h1>
              {b.lede && <p className="gb-lede">{b.lede}</p>}
              {b.actions && <p className="gb-actions">{b.actions.map((a) => <Button key={a.label} a={a} />)}</p>}
            </div>
            {b.media && b.media !== 'none' && <Box label="Lead image" aspect={b.media} />}
          </div>
        </Frame>
      );
    case 'prose':
      return (
        <Frame kind={b.kind} id={id} label={b.label} note={b.note}>
          <h2 className="gb-h2">{b.label}</h2>
          {Array.from({ length: b.paragraphs ?? 2 }, (_, i) => <p key={i} className="gb-para"><Lines n={4} /></p>)}
        </Frame>
      );
    case 'media':
      return (
        <Frame kind={b.kind} id={id} label={b.label} note={b.note}>
          <div className={`gb-grid ${(b.count ?? 1) > 1 ? 'gb-grid--3' : ''}`}>
            {Array.from({ length: b.count ?? 1 }, (_, i) => <Box key={i} label={b.label} aspect={b.aspect} />)}
          </div>
        </Frame>
      );
    case 'facts':
      return (
        <Frame kind={b.kind} id={id} label={b.label} note={b.note}>
          <h2 className="gb-h2">{b.label}</h2>
          <dl className="gb-facts">
            {b.items.map((it, i) => <div key={i}><dt>{it}</dt><dd><Lines n={1} last={0.5} /></dd></div>)}
          </dl>
        </Frame>
      );
    case 'collection': {
      const to = linkTo(b.to);
      return (
        <Frame kind={b.kind} id={id} label={b.label} note={b.note}>
          <h2 className="gb-h2">{b.label}</h2>
          <ul className={`gb-items gb-items--${b.layout ?? 'list'}`}>
            {Array.from({ length: b.count }, (_, i) => (
              <li key={i} className="gb-item">
                {b.media && <Box label={b.item} aspect="square" />}
                {to ? <a href={to}>{b.item} {i + 1}</a> : <span>{b.item} {i + 1}</span>}
                <Lines n={1} last={0.8} />
              </li>
            ))}
          </ul>
        </Frame>
      );
    }
    case 'timeline':
      return (
        <Frame kind={b.kind} id={id} label={b.label} note={b.note}>
          <h2 className="gb-h2">{b.label}</h2>
          <ol className="gb-timeline">
            {b.items.map((it) => <li key={it}><strong>{it}</strong><Lines n={2} /></li>)}
          </ol>
        </Frame>
      );
    case 'form':
      return (
        <Frame kind={b.kind} id={id} label={b.label} note={b.note}>
          <h2 className="gb-h2">{b.label}</h2>
          <div className="gb-form">
            {b.fields.map((f) => <FieldDrawing key={f.label} f={f} />)}
            <p className="gb-actions">
              {b.next ? <a className="gb-button gb-button--primary" href={linkTo(b.next)}>{b.submit}</a> : <span className="gb-button gb-button--primary">{b.submit}</span>}
            </p>
          </div>
        </Frame>
      );
    case 'tasks':
      return (
        <Frame kind={b.kind} id={id} label={b.label} note={b.note}>
          <h2 className="gb-h2">{b.label}</h2>
          <ol className="gb-tasks">
            {b.tasks.map((t) => (
              <li key={t.title}>
                {t.to ? <a href={linkTo(t.to)}>{t.title}</a> : <span>{t.title}</span>}
                <span className="gb-status">status</span>
              </li>
            ))}
          </ol>
        </Frame>
      );
    case 'map':
      return (
        <Frame kind={b.kind} id={id} label={b.label} note={b.note}>
          <div className="gb-map" role="img" aria-label={`Map: ${b.label}`}>
            {Array.from({ length: b.pins ?? 3 }, (_, i) => (
              <span key={i} className="gb-pin" style={{ insetInlineStart: `${12 + ((i * 37) % 76)}%`, insetBlockStart: `${18 + ((i * 53) % 64)}%` }} />
            ))}
            <span className="gb-box__label">{b.label}</span>
          </div>
        </Frame>
      );
    case 'faq':
      return (
        <Frame kind={b.kind} id={id} label={b.label} note={b.note}>
          <h2 className="gb-h2">{b.label}</h2>
          <ul className="gb-faq">{b.questions.map((q) => <li key={q}><span>{q}</span><span aria-hidden="true">+</span></li>)}</ul>
        </Frame>
      );
    case 'callout':
      return (
        <Frame kind={b.kind} id={id} label={b.label} note={b.note}>
          <div className="gb-callout">
            <h2 className="gb-h2">{b.label}</h2>
            <p className="gb-actions"><Button a={b.action} /></p>
          </div>
        </Frame>
      );
    case 'table':
      return (
        <Frame kind={b.kind} id={id} label={b.label} note={b.note}>
          {b.filters && <p className="gb-actions">{b.filters.map((f) => <span key={f} className="gb-input gb-input--filter">{f}</span>)}</p>}
          <div className="gb-table-wrap">
            <table className="gb-table">
              <thead><tr>{b.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
              <tbody>
                {Array.from({ length: b.rows ?? 5 }, (_, r) => (
                  <tr key={r}>{b.columns.map((c) => <td key={c}><Lines n={1} last={0.7} /></td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </Frame>
      );
    case 'chat':
      return (
        <Frame kind={b.kind} id={id} label={b.label} note={b.note}>
          <div className="gb-chat">
            <p className="gb-bubble gb-bubble--them"><Lines n={2} /></p>
            <p className="gb-bubble gb-bubble--me"><Lines n={1} /></p>
            {b.suggestions && <p className="gb-actions">{b.suggestions.map((s) => <span key={s} className="gb-chip">{s}</span>)}</p>}
            <span className="gb-input gb-input--text">Ask a question…</span>
          </div>
        </Frame>
      );
    case 'tabs':
      return (
        <Frame kind={b.kind} id={id} label={b.label} note={b.note}>
          <p className="gb-tabs">{b.tabs.map((t, i) => <span key={t.title} className={i === 0 ? 'gb-tab gb-tab--on' : 'gb-tab'}>{t.title}</span>)}</p>
          <Blocks blocks={b.tabs[0]!.blocks} prefix={`${id}.0.`} />
        </Frame>
      );
    case 'split':
      return (
        <div className="gb-split" data-block={id}>
          {b.columns.map((col, ci) => <div key={ci}><Blocks blocks={col} prefix={`${id}.${ci}.`} /></div>)}
        </div>
      );
  }
}

export function Blocks({ blocks, prefix = '' }: { blocks: Block[]; prefix?: string }) {
  return <>{blocks.map((b, i) => <BlockView key={blockId(b, i, prefix)} b={b} id={blockId(b, i, prefix)} />)}</>;
}

export function SiteFrame({ current, children }: { current: SitemapPage; children: ReactNode }) {
  return (
    <div className="gb-site">
      <header className="gb-header">
        <a className="gb-brand" href="/">Site name</a>
        <nav aria-label="Site">
          <ul className="gb-nav">
            {navPages().map((p) => (
              <li key={p.id}><a href={href(p)} aria-current={p.id === current.id ? 'page' : undefined}>{navLabel(p)}</a></li>
            ))}
          </ul>
        </nav>
      </header>
      {children}
      <footer className="gb-footer"><Lines n={2} last={0.4} /></footer>
    </div>
  );
}

export function StatusRibbon({ w }: { w: Wireframe }) {
  return (
    <aside className={`gb-status-ribbon gb-status-ribbon--${w.status}`} aria-label="Wireframe status">
      <strong>{w.status === 'derived' ? 'Not drawn yet' : w.status}</strong>
      {w.notes?.map((n) => <span key={n}>{n}</span>)}
    </aside>
  );
}
