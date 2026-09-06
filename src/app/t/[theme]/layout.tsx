import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { preload } from 'react-dom';
import { DEFAULT_THEME, getThemeMeta, isThemeId, THEME_IDS } from '@/themes/registry';

export const dynamicParams = false;

/** Both themes are real route trees (ADR-0009 §4): the proxy rewrites clean URLs here. */
export function generateStaticParams() {
  return THEME_IDS.map((theme) => ({ theme }));
}

type Params = { params: Promise<{ theme: string }> };

const metaFor = async (params: Params['params']) => {
  const { theme } = await params;
  return getThemeMeta(isThemeId(theme) ? theme : DEFAULT_THEME);
};

/** Browser chrome and icons follow the theme (DESIGN.md `neutral` via the generated tokens). */
export async function generateViewport({ params }: Params): Promise<Viewport> {
  const meta = await metaFor(params);
  return { width: 'device-width', initialScale: 1, themeColor: meta.themeColor };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const meta = await metaFor(params);
  return { icons: { icon: [{ url: meta.icon.svg, type: 'image/svg+xml' }], apple: [{ url: meta.icon.apple, sizes: '180x180' }] } };
}

export default async function ThemeLayout({ children, params }: { children: ReactNode; params: Promise<{ theme: string }> }) {
  const { theme } = await params;
  if (!isThemeId(theme)) notFound();
  const meta = getThemeMeta(theme);
  // Preload only the active theme's files (design-doc §10) as resource hints: one <link rel="preload"> each in production.
  for (const font of meta.fonts) preload(font.url, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.dataset.theme=${JSON.stringify(theme)};` }} />
      {children}
    </>
  );
}
