import type { ReactNode } from 'react';
import type { Reader } from '@/domain/content/page-context';
import { ANONYMOUS } from '@/lib/principal';
import { getTheme } from '@/themes';
import { DEFAULT_THEME } from '@/themes/registry';
import { buildPageFrame, getRequestTheme } from '@/themes/server';

export const LEGAL_LAST_UPDATED = 'November 1, 2026';

export async function LegalDocument({
  title,
  lede,
  currentPath,
  reader,
  children,
}: {
  title: string;
  lede: string;
  currentPath: '/privacy' | '/terms';
  reader: Reader;
  children: ReactNode;
}) {
  // The prerendered copy is nobody's, so its menu is the signed-out one outright. The per-request
  // page leaves the question open and the account menu asks in the browser, as it always has here.
  const theme = reader === 'anonymous' ? DEFAULT_THEME : await getRequestTheme();
  const frame = await buildPageFrame({ theme, currentPath, ...(reader === 'anonymous' ? { lifecycle: { principal: ANONYMOUS } } : {}) });
  const Shell = getTheme(theme).kit.Shell;
  return (
    <Shell frame={frame}>
      <article className="credits legal" aria-labelledby="page-title">
        <header className="credits__head">
          <p className="credits__eyebrow">For our guests</p>
          <h1 id="page-title" className="credits__title">
            {title}
          </h1>
          <p className="credits__lede">{lede}</p>
          <p className="credits__lede">
            <small>Last updated {LEGAL_LAST_UPDATED}.</small>
          </p>
        </header>
        {children}
      </article>
    </Shell>
  );
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="credits__section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="credits__h2">
        {title}
      </h2>
      {children}
    </section>
  );
}
