import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Principal } from '@/contracts/principal';

/** Admin pages use the neutral foundation (root DESIGN.md), never the guest themes. */
export function AdminShell({ title, principal, children }: { title: string; principal: Principal; children: ReactNode }) {
  if (principal.kind !== 'admin') {
    return (
      <main id="main" className="mx-auto w-full max-w-[60rem] px-5 py-10">
        <h1 className="text-3xl">{title}</h1>
        <p className="mt-4">Administrator sign-in is required.</p>
      </main>
    );
  }
  return (
    <main id="main" className="mx-auto w-full max-w-[60rem] px-5 py-10">
      <nav aria-label="Admin" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link className="underline-offset-4 hover:underline" href="/admin">
          Admin
        </Link>
        <Link className="underline-offset-4 hover:underline" href="/admin/transport">
          Transport
        </Link>
        <Link className="underline-offset-4 hover:underline" href="/admin/gifts">
          Gifts
        </Link>
        <Link className="underline-offset-4 hover:underline" href="/admin/reservations">
          Reservations
        </Link>
      </nav>
      <h1 className="mt-6 text-3xl">{title}</h1>
      {children}
    </main>
  );
}

/** Wide tables scroll inside a focusable, labelled region so keyboard users can reach the overflow (axe scrollable-region-focusable). */
export function ScrollRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}

export const TABLE = 'mt-4 w-full border-collapse text-sm';
export const TH = 'border-b border-primary/30 py-2 pr-4 text-left font-medium';
export const TD = 'border-b border-primary/10 py-2 pr-4 align-top';
export const SECTION_TITLE = 'mt-10 text-2xl';
