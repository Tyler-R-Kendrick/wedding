'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { callCapability, newIdempotencyKey } from '@/components/handoff/client';

/**
 * A one-click change that needs no questions: show or hide a fund or a link, move a fund up or down.
 *
 * Each call is a list of capability invocations run in order (a move is two saves: this fund's place
 * and its neighbour's). The row says what happened in words beside the button, and the page
 * refreshes from the server, so the list is never a guess about what was saved.
 */
export function QuickAction({ label, busyLabel, calls, accessibleName, tone = 'quiet' }: { label: string; busyLabel: string; calls: { capability: string; input: unknown }[]; accessibleName?: string; tone?: 'quiet' | 'ghost' }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    setBusy(true);
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
    startTransition(() => router.refresh());
  };

  const working = busy || pending;
  return (
    <span className="gs-quick">
      <button type="button" className={tone === 'ghost' ? 'ops-button ops-button-ghost' : 'flow-trigger-quiet'} onClick={run} disabled={working} aria-label={accessibleName}>
        {working ? busyLabel : label}
      </button>
      {error ? (
        <span role="alert" className="flow-field-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
