import { newId } from '@/contracts/ids';
import type { ReactNode } from 'react';
import './ops.css';

/*
 * Form primitives for the admin console.
 *
 * The page shell, the sign-in gate and the section wrapper used to live here too, as a second
 * shell (`OpsPage`) beside `console.tsx`'s: two page frames, two gates, two `Section`s, one
 * stylesheet, and a nav strip that repeated four of the links the layout already renders above it.
 * Level 16 moved every screen onto `ConsolePage`; what is left here is the parts that shell does
 * not have — labelled fields, a checkbox that reports its own presence, a submit button and a
 * render-time idempotency key.
 */

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

/** A checkbox that reports its presence, so an unchecked box means "false" and an absent one means "keep" (review N3). */
export function Checkbox({ id, label, name, defaultChecked }: { id: string; label: string; name?: string; defaultChecked?: boolean }) {
  return (
    <div className="ops-check">
      <input type="hidden" name={`${name ?? id}__present`} value="1" />
      <input id={id} name={name ?? id} type="checkbox" defaultChecked={defaultChecked} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

/**
 * A radio group with a real `<fieldset>`/`<legend>`.
 *
 * The screens that needed one were reaching into `components/rsvp/fields` — the GUEST RSVP kit —
 * for `ChoiceGroup`, so an admin correcting an answer got the guest form's widgets, sizes and
 * error styling on an operations screen. This is the console's own.
 */
export function Radios({ name, legend, options, describedBy }: { name: string; legend: string; options: { value: string; label: string; defaultChecked?: boolean }[]; describedBy?: string }) {
  return (
    <fieldset className="ops-field ops-radios" aria-describedby={describedBy}>
      <legend>{legend}</legend>
      {options.map((o) => (
        <div className="ops-check" key={o.value}>
          <input type="radio" id={`${name}-${o.value}`} name={name} value={o.value} defaultChecked={o.defaultChecked} />
          <label htmlFor={`${name}-${o.value}`}>{o.label}</label>
        </div>
      ))}
    </fieldset>
  );
}

export function Button({ children, variant = 'primary' }: { children: ReactNode; variant?: 'primary' | 'danger' | 'ghost' }) {
  return (
    <button type="submit" className={`ops-button ops-button-${variant}`}>
      {children}
    </button>
  );
}

/** Render-time idempotency key so a double-submitted admin form replays instead of repeating. */
export function IdemKey() {
  return <input type="hidden" name="idem" value={newId()} />;
}
