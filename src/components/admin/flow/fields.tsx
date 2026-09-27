'use client';

import type { ReactNode } from 'react';
import type { FlowContext } from './AdminFlow';

/*
 * The flow's fields. Every one has a visible label, a hint in words under it when it needs one, and
 * its error in words beside it (never colour alone) — DESIGN.md's input rules, which the console's
 * generic form met only for labels. Ids are `${uid}-${name}` so AdminFlow can move focus to the
 * first field a check or the server rejected.
 */

type Values = Record<string, unknown>;

function describedBy(uid: string, name: string, hint: boolean, error: boolean): string | undefined {
  const ids = [hint ? `${uid}-${name}-hint` : '', error ? `${uid}-${name}-error` : ''].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

function Hint({ uid, name, children }: { uid: string; name: string; children?: ReactNode }) {
  return children ? (
    <p id={`${uid}-${name}-hint`} className="flow-hint">
      {children}
    </p>
  ) : null;
}

function FieldError({ uid, name, message }: { uid: string; name: string; message?: string }) {
  return message ? (
    <p id={`${uid}-${name}-error`} className="flow-field-error">
      {message}
    </p>
  ) : null;
}

export function TextField<V extends Values>({
  ctx,
  name,
  label,
  hint,
  type = 'text',
  multiline,
  optional,
  autoComplete = 'off',
  inputMode,
  spellCheck,
}: {
  ctx: FlowContext<V>;
  name: keyof V & string;
  label: string;
  hint?: ReactNode;
  type?: 'text' | 'url' | 'email';
  multiline?: boolean;
  optional?: boolean;
  autoComplete?: string;
  inputMode?: 'text' | 'url' | 'email';
  spellCheck?: boolean;
}) {
  const id = `${ctx.uid}-${name}`;
  const error = ctx.errors[name];
  const common = {
    id,
    name,
    value: String(ctx.values[name] ?? ''),
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy(ctx.uid, name, Boolean(hint), Boolean(error)),
    className: 'ops-input flow-input',
    autoComplete,
    spellCheck,
  } as const;
  return (
    <div className="flow-field" data-invalid={error ? '' : undefined}>
      <label htmlFor={id} className="flow-label">
        {label}
        {optional ? <span className="flow-optional"> (optional)</span> : null}
      </label>
      {multiline ? (
        <textarea {...common} rows={4} onChange={(e) => ctx.set({ [name]: e.target.value } as Partial<V>)} />
      ) : (
        <input {...common} type={type} inputMode={inputMode} onChange={(e) => ctx.set({ [name]: e.target.value } as Partial<V>)} />
      )}
      <Hint uid={ctx.uid} name={name}>
        {hint}
      </Hint>
      <FieldError uid={ctx.uid} name={name} message={error} />
    </div>
  );
}

export interface Choice {
  value: string;
  label: string;
  description?: string;
  /** A short status beside the label ("set up"). */
  badge?: string;
}

/** One choice from a few, as full-width rows that are each a 44px+ target. A fieldset of radios underneath. */
export function ChoiceField<V extends Values>({ ctx, name, legend, choices, hint }: { ctx: FlowContext<V>; name: keyof V & string; legend: string; choices: Choice[]; hint?: ReactNode }) {
  const error = ctx.errors[name];
  return (
    <fieldset className="flow-choices" aria-describedby={describedBy(ctx.uid, name, Boolean(hint), Boolean(error))}>
      <legend className="flow-label">{legend}</legend>
      <Hint uid={ctx.uid} name={name}>
        {hint}
      </Hint>
      <div className="flow-choices__list">
        {choices.map((c, i) => {
          const id = i === 0 ? `${ctx.uid}-${name}` : `${ctx.uid}-${name}-${c.value}`;
          return (
            <label key={c.value} htmlFor={id} className="flow-choice">
              <input id={id} type="radio" name={name} value={c.value} checked={ctx.values[name] === c.value} onChange={() => ctx.set({ [name]: c.value } as Partial<V>)} />
              <span className="flow-choice__text">
                <span className="flow-choice__label">
                  {c.label}
                  {c.badge ? <span className="flow-badge">{c.badge}</span> : null}
                </span>
                {c.description ? <span className="flow-choice__desc">{c.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      <FieldError uid={ctx.uid} name={name} message={error} />
    </fieldset>
  );
}

export function CheckField<V extends Values>({ ctx, name, label, hint }: { ctx: FlowContext<V>; name: keyof V & string; label: string; hint?: ReactNode }) {
  const id = `${ctx.uid}-${name}`;
  const error = ctx.errors[name];
  return (
    <div className="flow-field">
      <label htmlFor={id} className="flow-check">
        <input
          id={id}
          type="checkbox"
          checked={Boolean(ctx.values[name])}
          aria-describedby={describedBy(ctx.uid, name, Boolean(hint), Boolean(error))}
          onChange={(e) => ctx.set({ [name]: e.target.checked } as Partial<V>)}
        />
        <span>{label}</span>
      </label>
      <Hint uid={ctx.uid} name={name}>
        {hint}
      </Hint>
      <FieldError uid={ctx.uid} name={name} message={error} />
    </div>
  );
}

/** A framed "this is what guests will see" block inside a step. */
export function GuestPreview({ label = 'What guests will see', children }: { label?: string; children: ReactNode }) {
  return (
    <figure className="flow-preview">
      <figcaption className="flow-preview__label">{label}</figcaption>
      <div className="flow-preview__body">{children}</div>
    </figure>
  );
}
