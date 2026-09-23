'use client';

import Link from 'next/link';
import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { href, page as sitemapPage } from '@wedding/sitemap';
import { blockId, type Action, type Block, type Field } from '@wedding/wireframe';
import { Media, Text, useHasContent } from './content';

/**
 * Stage 3's kit: every wireframe block kind, working. Links go where the wireframe says, forms
 * validate and report, tabs, accordions, dialogs and the map respond to keyboard and pointer.
 * Only content is missing — it is bones (see ./content.tsx). Stage 4 renders this same kit.
 */

const url = (id: string) => href(sitemapPage(id));

function ActionControl({ a, className = '' }: { a: Action; className?: string }) {
  const cls = `st-button st-button--${a.variant ?? 'secondary'} ${className}`;
  if (a.to) return <Link className={cls} href={url(a.to)}>{a.label}</Link>;
  return <Handoff label={a.label} destination={a.external ?? 'another site'} className={cls} />;
}

/** An off-site action announces where it goes before it goes (the real app's handoff pattern). */
function Handoff({ label, destination, className }: { label: string; destination: string; className: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.showModal()}>
        {label} <span aria-hidden="true">↗</span>
      </button>
      <dialog ref={ref} className="st-dialog" aria-labelledby={titleId}>
        <h2 id={titleId} className="st-h3">This leaves the site</h2>
        <p>&ldquo;{label}&rdquo; opens {destination}. At this stage the link is not wired to anything.</p>
        <form method="dialog" className="st-actions">
          <button className="st-button st-button--primary" value="close">Close</button>
        </form>
      </dialog>
    </>
  );
}

function FieldControl({ f, name }: { f: Field; name: string }) {
  const id = useId();
  const hintId = f.hint ? `${id}-hint` : undefined;
  if (f.type === 'radio' || f.type === 'checkbox') {
    return (
      <fieldset className="st-field st-field--group">
        <legend className="st-field__label">{f.label}{f.required && <span className="st-req"> (required)</span>}</legend>
        {f.hint && <p className="st-field__hint" id={hintId}>{f.hint}</p>}
        <div className="st-choices">
          {(f.options ?? ['Yes']).map((o, i) => (
            <label key={o} className="st-choice">
              <input type={f.type} name={name} value={o} required={f.required && f.type === 'radio' && i === 0} />
              <span>{o}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  const common = { id, name, required: f.required, 'aria-describedby': hintId, className: 'st-input' };
  let control: ReactNode;
  switch (f.type) {
    case 'textarea': control = <textarea {...common} rows={4} />; break;
    case 'select': control = <select {...common}>{f.options?.map((o) => <option key={o}>{o}</option>)}</select>; break;
    case 'code': control = <input {...common} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" />; break;
    case 'file': control = <input {...common} type="file" multiple />; break;
    default: control = <input {...common} type={f.type} autoComplete={f.type === 'email' ? 'email' : undefined} />;
  }
  return (
    <div className="st-field">
      <label className="st-field__label" htmlFor={id}>{f.label}{f.required && <span className="st-req"> (required)</span>}</label>
      {f.hint && <p className="st-field__hint" id={hintId}>{f.hint}</p>}
      {control}
    </div>
  );
}

function FormBlock({ b, id }: { b: Extract<Block, { kind: 'form' }>; id: string }) {
  const [done, setDone] = useState(false);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (e.currentTarget.reportValidity()) setDone(true);
  };
  return (
    <form className="st-form" onSubmit={onSubmit} aria-labelledby={`${id}-h`} noValidate={false}>
      <h2 className="st-h3" id={`${id}-h`}>{b.label}</h2>
      {b.fields.map((f, i) => <FieldControl key={f.label} f={f} name={`${id}-${i}`} />)}
      <div className="st-actions"><button className="st-button st-button--primary" type="submit">{b.submit}</button></div>
      <div role="status" className="st-form__status">
        {done && (
          <p>
            {b.submit}: accepted. Nothing is stored at this stage.
            {b.next && <> <Link href={url(b.next)}>Continue to {sitemapPage(b.next).title}</Link></>}
          </p>
        )}
      </div>
    </form>
  );
}

function Tabs({ b, id }: { b: Extract<Block, { kind: 'tabs' }>; id: string }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent) => {
    const n = b.tabs.length;
    const next = e.key === 'ArrowRight' ? (active + 1) % n : e.key === 'ArrowLeft' ? (active - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  };
  return (
    <section className="st-block st-tabs" aria-labelledby={`${id}-h`}>
      <h2 className="st-h3" id={`${id}-h`}>{b.label}</h2>
      <div role="tablist" aria-labelledby={`${id}-h`} className="st-tabs__list" onKeyDown={onKey}>
        {b.tabs.map((t, i) => (
          <button
            key={t.title}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            type="button"
            id={`${id}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            className="st-tabs__tab"
            onClick={() => setActive(i)}
          >
            {t.title}
          </button>
        ))}
      </div>
      {b.tabs.map((t, i) => (
        <div key={t.title} role="tabpanel" id={`${id}-panel-${i}`} aria-labelledby={`${id}-tab-${i}`} hidden={i !== active} className="st-tabs__panel">
          <Blocks blocks={t.blocks} prefix={`${id}.${i}.`} />
        </div>
      ))}
    </section>
  );
}

function Gallery({ b, id }: { b: Extract<Block, { kind: 'media' }>; id: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(0);
  const count = b.count ?? 1;
  return (
    <section className="st-block" aria-label={b.label}>
      <ul className={`st-gallery ${count > 1 ? 'st-gallery--grid' : ''}`}>
        {Array.from({ length: count }, (_, i) => (
          <li key={i}>
            <button type="button" className="st-gallery__open" aria-label={`Open ${b.label} ${i + 1} of ${count}`} onClick={() => { setOpen(i); ref.current?.showModal(); }}>
              <Media block={id} part={`image-${i}`} label={`${b.label} ${i + 1}`} aspect={b.aspect} />
            </button>
          </li>
        ))}
      </ul>
      <dialog ref={ref} className="st-dialog st-dialog--wide" aria-label={`${b.label} ${open + 1} of ${count}`}>
        <Media block={id} part={`image-${open}`} label={`${b.label} ${open + 1}`} aspect={b.aspect} />
        <form method="dialog" className="st-actions">
          <button type="button" className="st-button" disabled={open === 0} onClick={() => setOpen(open - 1)}>Previous</button>
          <button type="button" className="st-button" disabled={open === count - 1} onClick={() => setOpen(open + 1)}>Next</button>
          <button className="st-button st-button--primary" value="close">Close</button>
        </form>
      </dialog>
    </section>
  );
}

function MapBlock({ b, id }: { b: Extract<Block, { kind: 'map' }>; id: string }) {
  const pins = b.pins ?? 3;
  const [sel, setSel] = useState<number | null>(null);
  return (
    <section className="st-block" aria-labelledby={`${id}-h`}>
      <h2 className="st-h3" id={`${id}-h`}>{b.label}</h2>
      <div className="st-map">
        {Array.from({ length: pins }, (_, i) => (
          <button
            key={i}
            type="button"
            className="st-map__pin"
            aria-pressed={sel === i}
            aria-label={`Place ${i + 1}`}
            style={{ insetInlineStart: `${10 + ((i * 37) % 76)}%`, insetBlockStart: `${14 + ((i * 53) % 66)}%` }}
            onClick={() => setSel(sel === i ? null : i)}
          />
        ))}
      </div>
      <div className="st-map__detail" aria-live="polite">
        {sel === null ? <p>Choose a place on the map, or from the list.</p> : (
          <>
            <h3 className="st-h4">Place {sel + 1}</h3>
            <Text block={id} part={`pin-${sel}`} label={`Place ${sel + 1}`} lines={2} />
          </>
        )}
      </div>
      <ol className="st-map__list">
        {Array.from({ length: pins }, (_, i) => (
          <li key={i}><button type="button" className="st-linklike" onClick={() => setSel(i)}>Place {i + 1}</button></li>
        ))}
      </ol>
    </section>
  );
}

function TableBlock({ b, id }: { b: Extract<Block, { kind: 'table' }>; id: string }) {
  const [sort, setSort] = useState<{ col: number; dir: 'ascending' | 'descending' } | null>(null);
  const rows = b.rows ?? 5;
  return (
    <section className="st-block" aria-labelledby={`${id}-h`}>
      <h2 className="st-h3" id={`${id}-h`}>{b.label}</h2>
      {b.filters && (
        <div className="st-filters" role="search">
          {b.filters.map((f) => (
            <label key={f} className="st-field">
              <span className="st-field__label">{f}</span>
              <input className="st-input" type="search" />
            </label>
          ))}
        </div>
      )}
      <div className="st-table-wrap" tabIndex={0} role="region" aria-labelledby={`${id}-h`}>
        <table className="st-table">
          <thead>
            <tr>
              {b.columns.map((c, ci) => (
                <th key={c} scope="col" aria-sort={sort?.col === ci ? sort.dir : undefined}>
                  <button type="button" className="st-linklike" onClick={() => setSort({ col: ci, dir: sort?.col === ci && sort.dir === 'ascending' ? 'descending' : 'ascending' })}>
                    {c}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                {b.columns.map((c) => <td key={c}><Text block={id} part={`r${r}-${c}`} label={c} lines={1} as="span" /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Chat({ b, id }: { b: Extract<Block, { kind: 'chat' }>; id: string }) {
  const [asked, setAsked] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const ask = (q: string) => {
    if (!q.trim()) return;
    setAsked((a) => [...a, q.trim()]);
    setDraft('');
  };
  return (
    <section className="st-block st-chat" aria-labelledby={`${id}-h`}>
      <h2 className="st-h3" id={`${id}-h`}>{b.label}</h2>
      <ol className="st-chat__log" aria-live="polite">
        <li className="st-chat__msg st-chat__msg--them"><Text block={id} part="greeting" label="Greeting" lines={2} as="div" /></li>
        {asked.map((q, i) => (
          <li key={i} className="st-chat__pair">
            <p className="st-chat__msg st-chat__msg--me">{q}</p>
            <div className="st-chat__msg st-chat__msg--them"><Text block={id} part={`answer-${i}`} label={`Answer to "${q}"`} lines={3} as="div" /></div>
          </li>
        ))}
      </ol>
      {b.suggestions && (
        <div className="st-actions">
          {b.suggestions.map((s) => <button key={s} type="button" className="st-chip" onClick={() => ask(s)}>{s}</button>)}
        </div>
      )}
      <form className="st-chat__form" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
        <label htmlFor={inputId} className="st-field__label">Your question</label>
        <div className="st-chat__row">
          <input id={inputId} className="st-input" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="st-button st-button--primary" type="submit">Ask</button>
        </div>
      </form>
    </section>
  );
}

export function BlockView({ b, id }: { b: Block; id: string }) {
  switch (b.kind) {
    case 'masthead':
      return (
        <header className={`st-block st-masthead st-masthead--${b.media ?? 'none'}`}>
          <div className="st-masthead__text">
            <h1 className="st-h1">{b.title}</h1>
            {b.lede && <Text block={id} part="lede" label={b.lede} lines={2} className="st-lede" />}
            {b.actions && <div className="st-actions">{b.actions.map((a) => <ActionControl key={a.label} a={a} />)}</div>}
          </div>
          {b.media && b.media !== 'none' && <Media block={id} part="image" label="Lead image" aspect={b.media} />}
        </header>
      );
    case 'prose':
      return (
        <section className="st-block st-prose" aria-labelledby={`${id}-h`}>
          <h2 className="st-h2" id={`${id}-h`}>{b.label}</h2>
          {Array.from({ length: b.paragraphs ?? 2 }, (_, i) => <Text key={i} block={id} part={`p${i}`} label={`${b.label}, paragraph ${i + 1}`} lines={4} />)}
        </section>
      );
    case 'media':
      return <Gallery b={b} id={id} />;
    case 'facts':
      return (
        <section className="st-block" aria-labelledby={`${id}-h`}>
          <h2 className="st-h3" id={`${id}-h`}>{b.label}</h2>
          <dl className="st-facts">
            {b.items.map((it, i) => (
              <div key={i}>
                <dt>{it}</dt>
                <Text block={id} part={`fact-${i}`} label={it} lines={1} as="dd" />
              </div>
            ))}
          </dl>
        </section>
      );
    case 'collection':
      return (
        <section className="st-block" aria-labelledby={`${id}-h`}>
          <h2 className="st-h3" id={`${id}-h`}>{b.label}</h2>
          <ul className={`st-items st-items--${b.layout ?? 'list'}`}>
            {Array.from({ length: b.count }, (_, i) => {
              const title = <Text block={id} part={`item-${i}`} label={`${b.item} ${i + 1}`} lines={1} as="span" />;
              return (
                <li key={i} className="st-item">
                  {b.media && <Media block={id} part={`item-${i}-image`} label={`${b.item} ${i + 1}`} aspect="square" />}
                  {b.to ? <Link className="st-item__link" href={url(b.to)}>{title}</Link> : <span className="st-item__title">{title}</span>}
                  <Text block={id} part={`item-${i}-summary`} label={`${b.item} ${i + 1} summary`} lines={2} className="st-item__summary" />
                </li>
              );
            })}
          </ul>
        </section>
      );
    case 'timeline':
      return (
        <section className="st-block" aria-labelledby={`${id}-h`}>
          <h2 className="st-h3" id={`${id}-h`}>{b.label}</h2>
          <ol className="st-timeline">
            {b.items.map((it, i) => (
              <li key={it}>
                <details className="st-disclosure" open={i === 0}>
                  <summary>{it}</summary>
                  <Text block={id} part={`step-${i}`} label={it} lines={3} />
                </details>
              </li>
            ))}
          </ol>
        </section>
      );
    case 'form':
      return <section className="st-block"><FormBlock b={b} id={id} /></section>;
    case 'tasks':
      return (
        <section className="st-block" aria-labelledby={`${id}-h`}>
          <h2 className="st-h3" id={`${id}-h`}>{b.label}</h2>
          <ol className="st-tasks">
            {b.tasks.map((t, i) => (
              <li key={t.title}>
                {t.to ? <Link className="st-tasks__link" href={url(t.to)} aria-describedby={`${id}-s${i}`}>{t.title}</Link> : <span>{t.title}</span>}
                <span className="st-badge" id={`${id}-s${i}`}>Not started</span>
              </li>
            ))}
          </ol>
        </section>
      );
    case 'map':
      return <MapBlock b={b} id={id} />;
    case 'faq':
      return (
        <section className="st-block" aria-labelledby={`${id}-h`}>
          <h2 className="st-h3" id={`${id}-h`}>{b.label}</h2>
          {b.questions.map((q, i) => (
            <details key={q} className="st-disclosure">
              <summary>{q}</summary>
              <Text block={id} part={`answer-${i}`} label={`Answer: ${q}`} lines={2} />
            </details>
          ))}
        </section>
      );
    case 'callout':
      return (
        <aside className="st-block st-callout" aria-labelledby={`${id}-h`}>
          <h2 className="st-h3" id={`${id}-h`}>{b.label}</h2>
          <Text block={id} part="body" label={b.label} lines={1} />
          <div className="st-actions"><ActionControl a={b.action} /></div>
        </aside>
      );
    case 'table':
      return <TableBlock b={b} id={id} />;
    case 'chat':
      return <Chat b={b} id={id} />;
    case 'tabs':
      return <Tabs b={b} id={id} />;
    case 'split':
      return (
        <div className="st-split">
          {b.columns.map((col, ci) => <div key={ci} className="st-split__col"><Blocks blocks={col} prefix={`${id}.${ci}.`} /></div>)}
        </div>
      );
  }
}

export function Blocks({ blocks, prefix = '' }: { blocks: Block[]; prefix?: string }) {
  return <>{blocks.map((b, i) => <BlockView key={blockId(b, i, prefix)} b={b} id={blockId(b, i, prefix)} />)}</>;
}

/** A hint for the reader at stage 3 only: what is real here and what is not yet. */
export function StageHint() {
  const filled = useHasContent();
  if (filled) return null;
  return <p className="st-hint">Everything you can click works. Grey shapes are content nobody has written yet.</p>;
}
