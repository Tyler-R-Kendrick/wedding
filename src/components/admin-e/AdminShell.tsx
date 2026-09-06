import type { ReactNode } from 'react';
import { Notice } from '@/components/rsvp/fields';

export function AdminGate({ principalKind, children }: { principalKind: string; children: ReactNode }) {
  if (principalKind !== 'admin') {
    return (
      <main id="main" className="page">
        <h1 className="page__title">Administrator sign-in required</h1>
        <p>This page is for Sara, Tyler and the planner. TODO(Tyler &amp; Sara): admin sign-in lands with the identity swarm.</p>
      </main>
    );
  }
  return <>{children}</>;
}

export function Outcome({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <Notice tone="urgent" title="That did not work">{<p>{error}</p>}</Notice>;
  if (ok) return <Notice tone="success">{<p>{ok}</p>}</Notice>;
  return null;
}

export function Denied({ message }: { message: string }) {
  return (
    <main id="main" className="page">
      <h1 className="page__title">Not available</h1>
      <p>{message}</p>
    </main>
  );
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export async function outcomeFrom(searchParams: SearchParams): Promise<{ ok?: string; error?: string }> {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return { ok: one(sp.ok), error: one(sp.error) };
}
