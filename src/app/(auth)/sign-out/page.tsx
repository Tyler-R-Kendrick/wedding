import type { Metadata } from 'next';
import Link from 'next/link';
import { signOut } from '../_lib/actions';
import { Actions, AuthShell, Button } from '../_components/kit';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign out', robots: { index: false, follow: false } };

export default function SignOutPage() {
  return (
    <AuthShell eyebrow="Leaving?" title="Sign out" lede={<p>You can sign back in any time with a code — nothing to remember.</p>}>
      <form action={signOut}>
        <Actions>
          <Button>Sign out</Button>
          <Link className="auth-link" href="/">Stay signed in</Link>
        </Actions>
      </form>
    </AuthShell>
  );
}
