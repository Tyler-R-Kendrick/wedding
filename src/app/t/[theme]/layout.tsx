import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getThemeMeta, isThemeId, THEME_IDS } from '@/themes/registry';

export const dynamicParams = false;

/** Both themes are real route trees (ADR-0009 §4): the proxy rewrites clean URLs here. */
export function generateStaticParams() {
  return THEME_IDS.map((theme) => ({ theme }));
}

export default async function ThemeLayout({ children, params }: { children: ReactNode; params: Promise<{ theme: string }> }) {
  const { theme } = await params;
  if (!isThemeId(theme)) notFound();
  const meta = getThemeMeta(theme);
  return (
    <>
      {/* Preload only the active theme's three files (≤3 per theme, design-doc §10); React hoists these into <head>. */}
      {meta.fonts.map((font) => (
        <link key={font.url} rel="preload" as="font" type="font/woff2" href={font.url} crossOrigin="anonymous" />
      ))}
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.dataset.theme=${JSON.stringify(theme)};` }} />
      {children}
    </>
  );
}
