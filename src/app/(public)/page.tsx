import { HomeView } from './_views';

/**
 * Home for a reader with a session: a guest is sent on to `/guests`, an administrator's lifecycle
 * preview applies. Anyone else is served the prerendered copy (src/themes/routes.ts).
 */
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return <HomeView reader="request" />;
}
