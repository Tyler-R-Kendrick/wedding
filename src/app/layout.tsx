import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { LocalModelKeeper } from '@/components/local-models/LocalModelKeeper';
import { WebMcpBridge } from '@/webmcp/WebMcpBridge';
import { isWebMcpEnabled } from '@/webmcp/flag';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Sara + Tyler', template: '%s | Sara + Tyler' },
  // Says who, never when or where: this is the line a link preview and a search result print.
  description: 'Sara and Tyler’s wedding website, for their invited guests.',
  // noai/noimageai: the couple's photos and words are not for AI training (LICENSE, src/lib/rights.ts).
  robots: 'noindex, nofollow, noai, noimageai',
  // The default design's mark, for the trees whose layouts set none (auth, admin): without it every
  // one of those pages asked for /favicon.ico and got a 404. The public and guest layouts override it
  // with the active design's.
  icons: { icon: [{ url: '/icons/botanical-deco.svg', type: 'image/svg+xml' }], apple: [{ url: '/icons/botanical-deco-180.png', sizes: '180x180' }] },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * Root layout. The theme attribute lives on the Shell wrapper (rendered by every recipe) because
 * the resolved theme is a route param under /t/[theme] or a per-request header, neither of which
 * the root layout can read without opting the whole tree into dynamic rendering. The theme layout
 * mirrors it onto <html> before paint; suppressHydrationWarning covers that attribute.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        {/* Renders nothing; registers WebMCP tools when the browser has document.modelContext. */}
        {isWebMcpEnabled() && <WebMcpBridge />}
        {/* Renders nothing; looks for (and when allowed installs) the on-device models: src/lib/ai/local. */}
        <LocalModelKeeper />
      </body>
    </html>
  );
}
