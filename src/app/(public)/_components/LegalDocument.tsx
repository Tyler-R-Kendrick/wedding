import type { ReactNode } from 'react';
import { getTheme } from '@/themes';
import { buildPageFrame, getRequestTheme } from '@/themes/server';

export const LEGAL_LAST_UPDATED = 'November 1, 2026';

export async function LegalDocument({
  title,
  lede,
  currentPath,
  children,
}: {
  title: string;
  lede: string;
  currentPath: '/privacy' | '/terms';
  children: ReactNode;
}) {
  const theme = await getRequestTheme();
  const frame = await buildPageFrame({ theme, currentPath });
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
