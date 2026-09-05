import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/**
 * Theme-agnostic form primitives for the RSVP and admin surfaces. Contract (design-doc §6):
 * visible label always, 17px inputs, inline text errors bound with aria-describedby, 44px targets.
 * Expression is CSS-only (recipes.css) so the theme integrator restyles without touching markup.
 */
export interface FieldProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: (a: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function Field({ id, label, hint, error, required, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={error ? 'fld fld--error' : 'fld'}>
      <label className="fld__label" htmlFor={id}>
        {label}
        {required ? <span className="fld__req"> (required)</span> : null}
      </label>
      {hint ? (
        <p className="fld__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="fld__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
      {children({ id, describedBy, invalid: !!error })}
    </div>
  );
}

type InputProps = ComponentPropsWithoutRef<'input'> & { describedBy?: string; invalid?: boolean };
export function TextInput({ describedBy, invalid, className, ...rest }: InputProps) {
  return <input className={['inp', className].filter(Boolean).join(' ')} aria-describedby={describedBy} aria-invalid={invalid || undefined} {...rest} />;
}

type TextareaProps = ComponentPropsWithoutRef<'textarea'> & { describedBy?: string; invalid?: boolean };
export function Textarea({ describedBy, invalid, className, ...rest }: TextareaProps) {
  return <textarea className={['inp', 'inp--area', className].filter(Boolean).join(' ')} aria-describedby={describedBy} aria-invalid={invalid || undefined} {...rest} />;
}

type SelectProps = ComponentPropsWithoutRef<'select'> & { describedBy?: string; invalid?: boolean; placeholderLabel?: string };
export function Select({ describedBy, invalid, className, placeholderLabel, children, ...rest }: SelectProps) {
  return (
    <select className={['inp', 'inp--select', className].filter(Boolean).join(' ')} aria-describedby={describedBy} aria-invalid={invalid || undefined} {...rest}>
      {placeholderLabel ? <option value="">{placeholderLabel}</option> : null}
      {children}
    </select>
  );
}

export interface ChoiceProps {
  name: string;
  legend: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  options: Array<{ value: string; label: ReactNode; defaultChecked?: boolean }>;
  idBase: string;
  type?: 'radio' | 'checkbox';
}

/** Radio/checkbox group with a real fieldset + legend (the legend is the visible label). */
export function ChoiceGroup({ name, legend, hint, error, options, idBase, type = 'radio' }: ChoiceProps) {
  const hintId = hint ? `${idBase}-hint` : undefined;
  const errorId = error ? `${idBase}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <fieldset className={error ? 'fld fld--error' : 'fld'} aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
      <legend className="fld__label">{legend}</legend>
      {hint ? (
        <p className="fld__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="fld__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
      <div className="choice">
        {options.map((o) => {
          const id = `${idBase}-${o.value}`;
          return (
            <label key={o.value} className="choice__opt" htmlFor={id}>
              <input id={id} type={type} name={name} value={o.value} defaultChecked={o.defaultChecked} />
              <span>{o.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Checkbox({ id, name, label, defaultChecked, describedBy }: { id: string; name: string; label: ReactNode; defaultChecked?: boolean; describedBy?: string }) {
  return (
    <label className="choice__opt" htmlFor={id}>
      <input id={id} type="checkbox" name={name} value="yes" defaultChecked={defaultChecked} aria-describedby={describedBy} />
      <span>{label}</span>
    </label>
  );
}

type ButtonProps = ComponentPropsWithoutRef<'button'> & { variant?: 'primary' | 'secondary' | 'ghost'; pending?: boolean };
export function Button({ variant = 'primary', pending, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button className={['btn', `btn--${variant}`, className].filter(Boolean).join(' ')} aria-busy={pending || undefined} disabled={disabled || pending} {...rest}>
      {pending ? 'One moment…' : children}
    </button>
  );
}

/** Error summary that receives focus so keyboard and screen-reader users land on the first problem. */
export function ErrorSummary({ title = 'Please check a few things', errors }: { title?: string; errors: Array<{ href?: string; message: string }> }) {
  if (!errors.length) return null;
  return (
    <div className="errsum" role="alert" tabIndex={-1} id="error-summary">
      <h2 className="errsum__title">{title}</h2>
      <ul className="errsum__list">
        {errors.map((e, i) => (
          <li key={i}>{e.href ? <a href={e.href}>{e.message}</a> : e.message}</li>
        ))}
      </ul>
    </div>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'urgent' | 'success'; title?: ReactNode; children: ReactNode }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'urgent' ? 'alert' : 'status'}>
      {title ? <p className="notice__title">{title}</p> : null}
      <div className="notice__body">{children}</div>
    </div>
  );
}

/** Status text with an explicit word, never colour alone (design-doc §6 Badge). */
export function Badge({ tone, children }: { tone: 'yes' | 'no' | 'pending' | 'stale' | 'info'; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
