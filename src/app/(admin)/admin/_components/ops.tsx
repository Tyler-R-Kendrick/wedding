import Link from 'next/link';
import type { ReactNode } from 'react';
import './ops.css';

/** Plain, keyboard-complete admin primitives on the shared foundation tokens (no guest theme). */
export function OpsPage({ title, lede, children, notice }: { title: string; lede?: string; children: ReactNode; notice?: { ok?: string; error?: string } }) {
  return (
    <main id="main" className="ops">
      <nav aria-label="Guest operations" className="ops-nav">
        <Link href="/admin">Admin</Link>
        <Link href="/admin/guests">Guests</Link>
        <Link href="/admin/households">Households</Link>
        <Link href="/admin/invitations">Invitations</Link>
      </nav>
      <h1 className="ops-title">{title}</h1>
      {lede ? <p className="ops-lede">{lede}</p> : null}
      {notice?.ok ? (
        <p className="ops-notice ops-notice-ok" role="status">
          {notice.ok}
        </p>
      ) : null}
      {notice?.error ? (
        <p className="ops-notice ops-notice-error" role="alert">
          {notice.error}
        </p>
      ) : null}
      {children}
    </main>
  );
}

export function SignInRequired() {
  return (
    <main id="main" className="ops">
      <h1 className="ops-title">Administrator sign-in required</h1>
      <p>
        <Link href="/sign-in/admin">Sign in with your administrator email</Link>
      </p>
    </main>
  );
}

export function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className="ops-section" aria-labelledby={id ?? title.replace(/\W+/g, '-').toLowerCase()}>
      <h2 id={id ?? title.replace(/\W+/g, '-').toLowerCase()} className="ops-h2">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Input({ id, label, type = 'text', name, defaultValue, required, hint, options }: { id: string; label: string; type?: string; name?: string; defaultValue?: string; required?: boolean; hint?: string; options?: { value: string; label: string }[] }) {
  return (
    <div className="ops-field">
      <label htmlFor={id}>{label}</label>
      {hint ? <span className="ops-hint">{hint}</span> : null}
      {options ? (
        <select id={id} name={name ?? id} defaultValue={defaultValue} required={required} className="ops-input">
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : type === 'textarea' ? (
        <textarea id={id} name={name ?? id} defaultValue={defaultValue} required={required} className="ops-input" rows={6} />
      ) : (
        <input id={id} name={name ?? id} type={type} defaultValue={defaultValue} required={required} className="ops-input" />
      )}
    </div>
  );
}

export function Checkbox({ id, label, name }: { id: string; label: string; name?: string }) {
  return (
    <div className="ops-check">
      <input id={id} name={name ?? id} type="checkbox" />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

export function Button({ children, variant = 'primary' }: { children: ReactNode; variant?: 'primary' | 'danger' | 'ghost' }) {
  return (
    <button type="submit" className={`ops-button ops-button-${variant}`}>
      {children}
    </button>
  );
}
