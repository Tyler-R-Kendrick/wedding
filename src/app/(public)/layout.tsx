import type { ReactNode } from 'react';
import { getThemeMeta } from '@/themes/registry';
import { getRequestTheme } from '@/themes/server';

/**
 * Dynamic public routes (every page other swarms add under (public)/) read the theme the proxy
 * resolved and render `getTheme(theme).recipes.<page>(data)`; the Shell carries data-theme.
 */
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const theme = await getRequestTheme();
  return (
    <>
      {getThemeMeta(theme).fonts.map((font) => (
        <link key={font.url} rel="preload" as="font" type="font/woff2" href={font.url} crossOrigin="anonymous" />
      ))}
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.dataset.theme=${JSON.stringify(theme)};` }} />
      {children}
    </>
  );
}
