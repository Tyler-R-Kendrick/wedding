import { HomeView, staticParams } from '@/app/(public)/_views';

/**
 * Home as a signed-out reader sees it, prerendered. A lifecycle change reaches it within five
 * minutes, or at once when an administrator publishes one (src/app/api/capabilities/[name]/route.ts).
 */
export const revalidate = 300;
export const dynamic = 'error';
export const dynamicParams = false;
export const generateStaticParams = staticParams;

export default function StaticHomePage() {
  return <HomeView reader="anonymous" />;
}
