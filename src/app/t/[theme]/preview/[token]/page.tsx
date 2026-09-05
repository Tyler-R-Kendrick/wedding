import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getPrincipal } from '@/lib/principal';
import { isThemeId } from '@/themes/registry';
import { renderHome } from '@/themes/server';

/**
 * Home with an admin lifecycle preview (ADR-0012 §3). The proxy rewrites `/?preview=…` (or the
 * preview cookie) here; `resolveLifecycle` applies the preview only for admin principals, so
 * anyone else sees the published state. Always dynamic and `private, no-store`.
 */
export const dynamic = 'force-dynamic';

export default async function PreviewHomeRoute({ params }: { params: Promise<{ theme: string; token: string }> }) {
  const { theme, token } = await params;
  if (!isThemeId(theme)) notFound();
  const h = await headers();
  const principal = await getPrincipal(new Request('http://localhost/preview', { headers: h }));
  return renderHome({ theme, lifecycle: { principal, preview: { value: decodeURIComponent(token), source: 'query' } } });
}
