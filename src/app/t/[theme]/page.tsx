import { notFound } from 'next/navigation';
import { isThemeId } from '@/themes/registry';
import { renderHome } from '@/themes/server';

/** Home, statically rendered per theme; lifecycle changes propagate within a minute. */
export const revalidate = 60;

export default async function HomeRoute({ params }: { params: Promise<{ theme: string }> }) {
  const { theme } = await params;
  if (!isThemeId(theme)) notFound();
  return renderHome({ theme });
}
