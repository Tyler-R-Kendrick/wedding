'use client';

import { useEffect, useRef, useState } from 'react';

const LENGTH = 6;
const digitsOf = (raw: string) => raw.replace(/\D/g, '').slice(0, LENGTH);

/**
 * The six-digit code as six boxes, one per digit, each with a placeholder until it is typed.
 *
 * One real input carries the code, laid over the boxes and invisible: the phone's number pad
 * (`inputMode="numeric"`), the code a text message offers to fill in (`one-time-code`), a pasted code
 * and a screen reader all work on it as on any field, and its label is the field's own. Anything that
 * is not a digit is dropped as it is typed or pasted, so the field never holds a letter or a space.
 *
 * `onComplete` runs on the sixth digit, in the same event, so the page can show that it is checking
 * before the browser has even sent the code. `busy` holds the field still while it is checked.
 */
export function CodeCells({
  id = 'code',
  error,
  hasHint = true,
  busy = false,
  resetKey,
  onComplete,
}: {
  id?: string;
  error?: string | null;
  hasHint?: boolean;
  busy?: boolean;
  /** Changes when the field should start empty again (a code that did not work). */
  resetKey?: unknown;
  onComplete?: (code: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (resetKey === undefined) return;
    const el = ref.current;
    if (!el) return;
    el.value = '';
    setValue('');
    el.focus();
  }, [resetKey]);

  const onInput = (el: HTMLInputElement) => {
    const digits = digitsOf(el.value);
    if (el.value !== digits) el.value = digits;
    setValue(digits);
    if (digits.length === LENGTH) onComplete?.(digits);
  };

  const describedBy = [error ? `${id}-error` : null, hasHint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  const active = Math.min(value.length, LENGTH - 1);
  return (
    <div className={`auth-code${focused ? ' is-focused' : ''}${busy ? ' is-busy' : ''}${error ? ' is-invalid' : ''}`}>
      <input
        ref={ref}
        id={id}
        name="code"
        className="auth-code__input"
        type="text"
        inputMode="numeric"
        pattern="[0-9]{6}"
        autoComplete="one-time-code"
        // No maxLength: the browser would cut a pasted "123 456" to "123 45" before the space is dropped.
        // The digits are kept to six here instead.
        minLength={LENGTH}
        required
        spellCheck={false}
        readOnly={busy}
        aria-busy={busy || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        autoFocus
        onInput={(e) => onInput(e.currentTarget)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <span className="auth-code__cells" aria-hidden="true">
        {Array.from({ length: LENGTH }, (_, i) => {
          const digit = value[i];
          return (
            <span key={i} className={`auth-code__cell${digit ? ' is-filled' : ''}${focused && !busy && i === active ? ' is-active' : ''}`}>
              {digit ?? <span className="auth-code__placeholder">–</span>}
            </span>
          );
        })}
      </span>
    </div>
  );
}
