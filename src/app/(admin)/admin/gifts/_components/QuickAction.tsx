'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { callCapability, newIdempotencyKey } from '@/components/handoff/client';

/**
 * A one-click change that needs no questions: show or hide a fund or a link, move a fund up or down.
 *
 * Each call is a list of capability invocations run in order (a move is two saves: this fund's place
 * and its neighbour's). The row says what happened in words beside the button, and the page
 * refreshes from the server, so the list is never a guess about what was saved.
 *
 * Focus stays on the button that was pressed. A move re-orders the rows, and React re-inserts one of
 * them, which drops focus to <body> in Chromium if the pressed button was in the moved row; the
 * button takes it back once the refresh lands. Up and Down stay rendered at the ends of the list
 * (`unavailable`, announced as dimmed), so pressing Up on the second fund never deletes the button
 * that has focus.
 */
export function QuickAction({
  label,
  busyLabel,
  done = 'Saved.',
  calls,
  accessibleName,
  unavailable,
  tone = 'quiet',
}: {
  label: string;
  busyLabel: string;
  done?: string;
  calls: { capability: string; input: unknown }[];
  accessibleName?: string;
  /** Rendered but inert (the top fund's Up), so the row keeps its shape and focus has somewhere to stay. */
  unavailable?: boolean;
  tone?: 'quiet' | 'ghost';
}) {
  const router = useRouter();
  const ref = useRef<HTMLButtonElement>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (pending || busy || !refocus.current) return;
    refocus.current = false;
    if (document.activeElement !== ref.current) ref.current?.focus();
  }, [pending, busy]);

  const run = async () => {
    if (unavailable || busy || pending) return;
    setError(null);
    setStatus(null);
    setBusy(true);
    refocus.current = true;
    for (const c of calls) {
      const res = await callCapability(c.capability, { input: c.input, idempotencyKey: newIdempotencyKey() });
      if (!res.ok) {
        setBusy(false);
        if (res.error?.code === 'step_up_required') {
          router.push(`/step-up?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }
        setError(res.error?.message ?? 'That did not save.');
        return;
      }
    }
    setBusy(false);
    setStatus(done);
    startTransition(() => router.refresh());
  };

  const working = busy || pending;
  return (
    <span className="gs-quick">
      <button
        ref={ref}
        type="button"
        className={tone === 'ghost' ? 'ops-button ops-button-ghost' : 'flow-trigger-quiet'}
        onClick={run}
        aria-disabled={working || unavailable || undefined}
        aria-label={accessibleName}
      >
        {working ? busyLabel : label}
      </button>
      <span className="sr-only" role="status">
        {status}
      </span>
      {error ? (
        <span role="alert" className="flow-field-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
