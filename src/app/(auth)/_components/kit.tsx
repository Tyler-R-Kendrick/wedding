import { Placeholder } from '@/components/provenance';
import type { ReactNode } from 'react';

/**
 * Recipe-style primitives for the auth journeys. Structure and a11y live here; every color,
 * font and radius comes from tokens in auth.css so the theme integrator can restyle by
 * swapping the stylesheet, not the markup. 390px first, 17px inputs, visible labels always.
 */
export function AuthShell({ eyebrow, title, lede, children, footer }: { eyebrow?: string; title: string; lede?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main id="main" className="auth-shell">
      <article className="auth-card" aria-labelledby="auth-title">
        {eyebrow ? <p className="auth-eyebrow">{eyebrow}</p> : null}
        <h1 id="auth-title" className="auth-title">
          {title}
        </h1>
        {lede ? <div className="auth-lede">{lede}</div> : null}
        {children}
      </article>
      {footer ? <footer className="auth-footer">{footer}</footer> : null}
    </main>
  );
}

export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="auth-field">
      <label htmlFor={id} className="auth-label">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="auth-hint">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'error' | 'success'; title?: string; children: ReactNode }) {
  return (
    <div className={`auth-notice auth-notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {title ? <p className="auth-notice-title">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}

export function Button({ children, variant = 'primary', type = 'submit', name, value, formAction }: { children: ReactNode; variant?: 'primary' | 'ghost'; type?: 'submit' | 'button'; name?: string; value?: string; formAction?: (formData: FormData) => void | Promise<void> }) {
  return (
    <button type={type} name={name} value={value} formAction={formAction} className={`auth-button auth-button-${variant}`}>
      {children}
    </button>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className="auth-actions">{children}</div>;
}

/** Six-digit code input: numeric keyboard, one-time-code autofill, 17px so iOS never zooms. */
export function CodeInput({ id = 'code', error }: { id?: string; error?: string | null }) {
  return (
    <input
      id={id}
      name="code"
      className="auth-input auth-input-code"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="one-time-code"
      maxLength={6}
      minLength={6}
      required
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : `${id}-hint`}
      autoFocus
    />
  );
}

/**
 * A guest who cannot get in reads this. It carried the raw `TODO(Tyler & Sara):` marker and was
 * rendered verbatim below — on the recovery panel, which is exactly where a stuck guest lands.
 * The marker is authoring syntax; what a guest should read is that a person is still writing it.
 * Same treatment as the travel facts (level 08) and the guest surfaces (level 07); the missing fact
 * is content-backlog X-07.
 */
export const RECOVERY_CONTACT = 'how to reach us if you are stuck';

export function RecoveryPanel({ title, message }: { title: string; message: string }) {
  return (
    <Notice tone="info" title={title}>
      <p>{message}</p>
      <p className="auth-hint">
        <Placeholder inline>{RECOVERY_CONTACT}</Placeholder>
      </p>
      <p>
        <a className="auth-link" href="/sign-in">
          Already claimed? Sign in with your email
        </a>
      </p>
    </Notice>
  );
}
