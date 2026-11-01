import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getPrincipal } from '@/lib/principal';
import { isThemeId } from '@/themes/registry';
import { renderHome } from '@/themes/server';

/** Home resolves the reader so signed-in guests and view-role previews canonicalize onto `/guests`. */
export const dynamic = 'force-dynamic';

export default async function HomeRoute({ params }: { params: Promise<{ theme: string }> }) {
  const { theme } = await params;
  if (!isThemeId(theme)) notFound();
  const h = await headers();
  const principal = await getPrincipal(new Request('http://wedding.local/', { headers: h }));
  return renderHome({ theme, lifecycle: { principal } });
}
