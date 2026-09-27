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
 *
 * The admin kit (`components/admin/flow`) replaced every form that used the submit button, the
 * confirm box, the radio group and the idempotency field; what is left here is the two fields the
 * console's search forms (`FilterBar`) still use.
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

