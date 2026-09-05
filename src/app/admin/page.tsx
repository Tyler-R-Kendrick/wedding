import { headers } from 'next/headers';
import { getPrincipal } from '@/lib/principal';

export const dynamic = 'force-dynamic';

/** Stub. The admin swarm builds the console; this only proves the server-side gate shape. */
export default async function AdminPage() {
  const h = await headers();
  const principal = await getPrincipal(new Request('http://admin.local/admin', { headers: h }));
  const isAdmin = principal.kind === 'admin';
  return (
    <main id="main">
      <h1>Admin</h1>
      {isAdmin ? <p>Signed in as an administrator.</p> : <p>Administrator sign-in is required. TODO(Tyler &amp; Sara): admin console.</p>}
    </main>
  );
}
